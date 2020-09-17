import request from 'request-promise-native';
import Raven from 'raven';
import RavenLambdaWrapper from 'serverless-sentry-lib';
import * as aws from 'aws-sdk';

import getTiming from '../lib/timing';
import urls from '../lib/urls';
import fragmentSender from '../lib/fragmentSender';
import { assemblePush, getLatestPush, markSent, markSending } from '../lib/pushData';
import { Chat } from '../lib/facebook';
import ddb from '../lib/dynamodb';
import subscriptions from '../lib/subscriptions';
import { trackLink, regexSlug } from '../lib/utils';
import Webtrekk from '../lib/webtrekk';
import { sleep } from '../lib/utils';

export const proxy = RavenLambdaWrapper.handler(Raven, async (event) => {
    const params = {
        stateMachineArn: process.env.statemachine_arn,
        input: typeof event === 'string' ? event : JSON.stringify(event),
    };

    const stepfunctions = new aws.StepFunctions();

    await stepfunctions.startExecution(params).promise();
    console.log('started execution of step function');
    return {
        statusCode: 200,
        body: 'OK',
    };
});

export const fetch = RavenLambdaWrapper.handler(Raven, async (event) => {
    console.log(JSON.stringify(event, null, 2));

    if ('body' in event) {
        event = JSON.parse(event.body);
    }

    if (event.report) {
        try {
            const params = {
                uri: `${urls.report(event.report)}?withFragments=1`,
                json: true,
            };
            // Authorize so we can access unpublished items
            if (event.preview) {
                params.headers = { Authorization: 'Token ' + process.env.CMS_API_TOKEN };
            }
            const report = await request(params);
            console.log('Starting to send report with id:', report.id);
            if (!event.preview) {
                await markSending(report.id, 'report');
            }
            return {
                state: 'nextChunk',
                timing: 'breaking',
                type: 'report',
                data: report,
                preview: event.preview,
                recipients: 0,
                blocked: 0,
            };
        } catch (error) {
            console.log('Sending report failed: ', JSON.stringify(error, null, 2));
            throw error;
        }
    }

    try {
        let push, timing;
        if (event.preview) {
            const params = {
                uri: urls.push(event.push),
                json: true,
            };
            // Authorize so we can access unpublished items
            params.headers = { Authorization: 'Token ' + process.env.CMS_API_TOKEN };
            push = await request(params);
        } else if (event.manual) {
            const params = {
                uri: urls.push(event.push),
                json: true,
            };
            push = await request(params);
            timing = push.timing;
        } else {
            try {
                timing = getTiming(event);
            } catch (e) {
                console.log(e);
                return { state: 'finished' };
            }
            push = await getLatestPush(timing, { 'delivered_fb': 'not_sent' });
        }
        console.log('Starting to send push with id:', push.id);
        if (!event.preview) {
            await markSending(push.id, 'push');
        }
        return {
            state: 'nextChunk',
            timing,
            type: 'push',
            data: push,
            preview: event.preview,
            recipients: 0,
            blocked: 0,
        };
    } catch (error) {
        console.log('Sending push failed: ', JSON.stringify(error, null, 2));
        throw error;
    }
});

const reasons = {
    UNKNOWN: 'unknown',
    TIMED_OUT: 'timed out',
    BLOCKED: 'blocked',
};

const handlePushFailed = async (chat, error) => {
    console.error(error);

    if (error.error.code === 'ETIMEDOUT') {
        console.error('Request timed out!');
        Raven.captureException(error);
        return reasons.TIMED_OUT;
    } else if (error.statusCode !== 400) {
        console.error('Not a bad request!');
        Raven.captureException(error);
        return reasons.UNKNOWN;
    }

    // Handle FB error codes
    const resp = error.error.error; // Yes, this is real

    // 551: This person isn't available right now.
    // 100 / 2018001: No matching user found
    if (resp.code === 551 || resp.code === 100 && resp['error_subcode'] === 2018001) {
        console.log(`Deleting user ${chat.psid} due to code ${resp.code}`);
        await subscriptions.remove(chat.psid);
        return reasons.BLOCKED;
    } else {
        console.error(`Unknown error code ${resp.code}!`);
        Raven.captureException(error);
        return reasons.UNKNOWN;
    }
};

export const send = RavenLambdaWrapper.handler(Raven, async (event) => {
    console.log(`attempting to push chunk for ${event.type}`, event.data.id);

    try {
        let users, last;
        if (event.preview) {
            users = [ { psid: event.preview } ];
        } else {
            const result = await getUsers(event.timing, event.start);
            users = result.users;
            last = result.last;
        }

        if (users.length === 0) {
            return {
                state: 'finished',
                id: event.data.id,
                type: event.type,
                preview: event.preview,
                timing: event.timing,
                data: event.data,
                recipients: event.recipients,
                blocked: event.blocked,
            };
        }

        // FIXME: Sleep to prevent rate limiting
        await sleep(1000);

        if (event.type === 'report') {
            const report = event.data;
            const payload = {
                action: 'report_start',
                report: report.id,
                type: 'report',
                preview: event.preview,
                track: {
                    category: `Breaking-Push-${report.id}`,
                    event: `Breaking Meldung`,
                    label: report.subtype ?
                        `${report.subtype.title}: ${report.headline}` :
                        report.headline,
                    subType: `1.Bubble (${report.question_count + 1})`,
                    publicationDate: report.published_date,
                },
            };

            if (report.is_quiz) {
                payload.quiz = true;
            }
            if (report.link) {
                if (report.type === 'breaking') {
                    payload.link = trackLink(
                        report.link, {
                            campaignType: 'breaking_push',
                            campaignName: regexSlug(report.headline),
                            campaignId: report.id,
                        });
                } else {
                    payload.link = report.link;
                }
            }
            if (report.audio) {
                payload.audio = report.audio;
            }
            /*
            const unsubscribeNote = 'Um Eilmeldungen abzubestellen, schreibe "Stop".';
            let messageText;
            if (report.type === 'breaking') {
                messageText = `🚨 ${report.headline}\n\n${report.text}\n\n${unsubscribeNote}`;
            } else {
                messageText = report.text;
            }
            */
            const messageText = report.text;

            if (report.type === 'breaking') {
                payload.nextAsButton = true;
            }

            await Promise.all(users.map(async (user) => {
                const chat = new Chat({ sender: { id: user.psid } });
                event.recipients++;
                try {
                    await fragmentSender(
                        chat,
                        report.next_fragments,
                        payload,
                        messageText,
                        report.attachment,
                        {
                            timeout: 20000,
                            extra: {
                                'messaging_type': 'MESSAGE_TAG',
                                tag: 'NON_PROMOTIONAL_SUBSCRIPTION',
                            },
                        }
                    );
                } catch (err) {
                    const reason = await handlePushFailed(chat, err);
                    if (reason === reasons.BLOCKED) {
                        event.blocked++;
                    }
                }
            }));
        } else if (event.type === 'push') {
            const { messageText, buttons, quickReplies } = assemblePush(event.data, event.preview);
            await Promise.all(users.map(async (user) => {
                const chat = new Chat({ sender: { id: user.psid } });
                event.recipients++;
                try {
                    await chat.sendButtons(
                        messageText,
                        buttons,
                        quickReplies,
                        {
                            timeout: 20000,
                            extra: {
                                'messaging_type': 'MESSAGE_TAG',
                                tag: 'NON_PROMOTIONAL_SUBSCRIPTION',
                            },
                        },
                    );
                } catch (err) {
                    const reason = await handlePushFailed(chat, err);
                    if (reason === reasons.BLOCKED) {
                        event.blocked++;
                    }
                }
            }));
        }
        console.log(`${event.type} sent to ${users.length} users`);

        // LastEvaluatedKey is empty, scan is finished
        if (!last) {
            return {
                state: 'finished',
                id: event.data.id,
                type: event.type,
                preview: event.preview,
                timing: event.timing,
                data: event.data,
                recipients: event.recipients,
                blocked: event.blocked,
            };
        }

        return {
            state: 'nextChunk',
            timing: event.timing,
            type: event.type,
            data: event.data,
            start: last,
            preview: event.preview,
            recipients: event.recipients,
            blocked: event.blocked,
        };
    } catch (err) {
        console.error('Sending failed:', err);
        throw err;
    }
});

export function getUsers(timing, start = null, limit = 25) {
    const params = {
        Limit: limit,
        TableName: process.env.DYNAMODB_SUBSCRIPTIONS,
        FilterExpression: `${timing} = :p`,
        ExpressionAttributeValues: { ':p': 1 },
    };

    if (start) {
        params.ExclusiveStartKey = start;
    }
    return new Promise((resolve, reject) => {
        ddb.scan(params, (err, data) => {
            if (err) {
                return reject(err);
            }
            resolve({ users: data.Items, last: data.LastEvaluatedKey });
        });
    });
}

export const finish = RavenLambdaWrapper.handler(Raven, function(event, context, callback) {
    console.log(`Sending of ${event.type} finished:`, event);

    if (event.preview) {
        console.log(`Only a preview, not marking as sent.`);
        return callback(null, {});
    }

    if (!event.id) {
        return callback(null, {});
    }

    const webtrekk = new Webtrekk('FB12345');
    let trackCategory = 'Preview';
    switch (event.timing) {
    case 'morning':
        trackCategory = `Morgen-Push-${event.data.id}`;
        break;
    case 'evening':
        trackCategory = `Abend-Push-${event.data.id}`;
        break;
    case 'breaking':
        trackCategory = `Breaking-Push-${event.data.id}`;
    }
    webtrekk.track({
        category: trackCategory,
        event: 'Zugestellt',
        label: event.data.headline,
        publicationDate: event.data.pub_date || event.data.published_date,
        recipients: event.recipients,
        blocked: event.blocked,
    });

    markSent(event.id, event.type)
        .then(() => callback(null, {}))
        .catch((err) => callback(err, {}));
});
