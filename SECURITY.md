# Security

Your Looker API credentials (client ID and client secret) are stored locally in the `looker-config.json` file. This file is explicitly excluded from version control via `.gitignore`. 

## Data Handling
- **Credentials:** Your API keys are only used to authenticate your local session against the Looker instance you specify.
- **Third-Party Services:** No credentials, metadata, or queries are ever sent to Google, Anthropic, or any other third-party telemetry services. All API interactions happen directly between your machine and your Looker instance.
- **Manifests:** When installing the manifest, changes are made within a dedicated Looker dev workspace. They do not affect production until explicitly deployed via the Looker IDE.
