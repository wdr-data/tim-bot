#!/bin/bash

table_prefix="wdraktuell-bot-fb-prod"

echo "Morning:"
aws dynamodb scan --table-name ${table_prefix}-subscriptions --filter-expression "morning = :mo" --expression-attribute-values '{":mo": {"N": "1"}}' --select "COUNT" | jq .Count
echo ""

echo "Evening:"
aws dynamodb scan --table-name ${table_prefix}-subscriptions --filter-expression "evening = :ev" --expression-attribute-values '{":ev": {"N": "1"}}' --select "COUNT" | jq .Count
echo ""

echo "Morning and evening:"
aws dynamodb scan --table-name ${table_prefix}-subscriptions --filter-expression "morning = :mo and evening = :ev" --expression-attribute-values '{":mo": {"N": "1"}, ":ev": {"N": "1"}}' --select "COUNT" | jq .Count
echo ""

echo "Breaking:"
aws dynamodb scan --table-name ${table_prefix}-subscriptions --filter-expression "breaking = :br" --expression-attribute-values '{":br": {"N": "1"}}' --select "COUNT" | jq .Count
echo ""

echo "Unique:"
aws dynamodb scan --table-name ${table_prefix}-subscriptions --filter-expression "morning = :mo or evening = :ev or breaking = :br" --expression-attribute-values '{":mo": {"N": "1"}, ":ev": {"N": "1"},  ":br": {"N": "1"}}' --select "COUNT" | jq .Count
echo ""

echo "Analytics enabled: "
aws dynamodb scan --table-name ${table_prefix}-tracking --filter-expression "enabled = :en" --expression-attribute-values '{":en": {"BOOL": true}}' --select "COUNT" | jq .Count
echo ""
