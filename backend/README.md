# Backend

AWS API Gateway (HTTP API) + two Python Lambda functions + a DynamoDB table. The public contract is in [`docs/api-contract.md`](../docs/api-contract.md).

| Route | Lambda | Folder |
|---|---|---|
| `POST /sightings` | submit-sighting | [`submit-sighting/`](submit-sighting/) |
| `GET /sightings` | get-sightings | [`get-sightings/`](get-sightings/) |

Base URL: `https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com`

## CORS (required for the frontend)

Browsers only accept API responses that include an `Access-Control-Allow-Origin` header. curl ignores CORS, so a route can work in curl and still be blocked in every browser.

**API Gateway console → your HTTP API → CORS → Configure:**

| Setting | Value |
|---|---|
| Access-Control-Allow-Origin | `https://<github-user>.github.io`, `http://localhost:8000` (or `*` during the hackathon) |
| Access-Control-Allow-Methods | `GET, POST, OPTIONS` |
| Access-Control-Allow-Headers | `content-type` |
| Access-Control-Max-Age | `300` |

Save. HTTP APIs apply this automatically; no redeploy is needed for `$default` auto-deploy stages. Check it with:

```bash
curl -s -D - -o /dev/null -H "Origin: http://localhost:8000" https://zxigfjv1p9.execute-api.us-east-1.amazonaws.com/sightings | grep -i access-control
```

It should print `access-control-allow-origin: ...`. If the Lambdas also set CORS headers themselves, the API Gateway setting takes precedence.

## Table schema

<!-- Backend owner: fill in from the AWS console. -->

| Attribute | Type | Notes |
|---|---|---|
| `sightingId` | String | Partition key? |
| `lat` | Number | |
| `long` | Number | |
| `timestamp` | Number | Seconds since 1970 |
| `caption` | String | Optional, max 200 chars |

TODO: table name, keys/indexes, and whether old sightings expire via TTL.

## IAM policies

TODO: the execution role for each Lambda (for example `dynamodb:PutItem` for submit-sighting, `dynamodb:Query`/`Scan` for get-sightings) and the CORS settings on the API.

## Deploying

TODO: how to update each function (console upload, zip + `aws lambda update-function-code`, or SAM).
