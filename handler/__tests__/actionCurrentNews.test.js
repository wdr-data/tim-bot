const { Expect } = require('../../lib/testing');
const facebook = require('../../lib/facebook');

const currentNews = require('../actionCurrentNews').default;

describe('actionCurrentNews', () => {
    it('sends a specific message with a button and quick replies', async () => {
    // e4d4c2941dd54f549393e9c3384e2d10900d36c7
        const chat = new facebook.Chat();
        await currentNews(chat, { intro: true });
        new Expect(chat)
            .buttons(
                'Hey, alles klar bei dir? Dein Informant ist wieder hier - ' +
                'und das habe ich für dich:',
                [
                    facebook.buttonPostback(
                        'Alle Infos',
                        {
                            action: 'report_start',
                            push: 4,
                            report: 2,
                            type: 'push',
                        }),
                    facebook.buttonPostback(
                        'Aktuelle Infos 🎧',
                        {
                            action: 'current_audio',
                            category: 'push-evening-2018-03-20',
                            event: 'current audio',
                            label: 'wdr aktuell',
                        }),
                ],
                [
                    {
                        imageUrl: null,
                        payload: {
                            action: 'report_start',
                            before: [],
                            category: 'push-Abendpush 21.03.',
                            event: 'report-Luft in einigen NRW-Städten ist besser geworden',
                            label: 0,
                            push: 4,
                            report: 2,
                            type: 'push',
                        },
                        title: '➡ Bessere Luft',
                    },
                    {
                        imageUrl: null,
                        payload: {
                            action: 'report_start',
                            before: [],
                            category: 'push-Abendpush 21.03.',
                            event: 'report-Unfall löst Diskussion über selbstfahrende Autos aus',
                            label: 0,
                            push: 4,
                            report: 253,
                            type: 'push',
                        },
                        title: '➡ Unfall',
                    },
                    {
                        imageUrl: null,
                        payload: {
                            action: 'report_start',
                            before: [],
                            category: 'push-Abendpush 21.03.',
                            event: 'report-Public Viewing wird auch nach 22 Uhr erlaubt',
                            label: 0,
                            push: 4,
                            report: 251,
                            type: 'push',
                        },
                        title: '➡ Public Viewing',
                    },
                    {
                        imageUrl: null,
                        payload: {
                            action: 'report_start',
                            before: [],
                            category: 'push-Abendpush 21.03.',
                            event: 'report-Das Letzte: Deine Songs zum Glücklichsein',
                            label: 0,
                            push: 4,
                            report: 254,
                            type: 'push',
                        },
                        title: '➡ Das Letzte',
                    },
                ]
            );
    });
});
