# Security & Privacy

At Ratchet, we understand that your code is your most valuable asset. That's why we've built Ratchet with a security-first architecture that keeps your code on your machine, under your control, at all times.

## Core Security Principles

### Local-First Architecture
Ratchet runs entirely as a CLI tool on your local machine. Your source code never leaves your filesystem except for the specific snippets you explicitly choose to send to your AI provider for analysis. There's no cloud component that stores, processes, or analyzes your code.

### Bring Your Own Key (BYOK)
On the Pro plan, you provide your own API key to the AI provider of your choice (Anthropic, OpenAI, etc.). This means:
- Your API key is stored and used locally by the CLI
- Ratchet never sees, stores, or proxies your API credentials
- You maintain full control over your AI provider relationship and billing
- Your code snippets go directly to your chosen provider, governed by their privacy policy

## What Happens to Your Code

### Local Processing
All code analysis happens on your machine using regex patterns and AST parsing. This includes:
- Security vulnerability detection
- Code quality scoring
- Dependency analysis
- Test suite evaluation

### AI Provider Interaction
Only when you request fixes for specific issues does Ratchet send relevant code snippets to your configured AI provider. These snippets are:
- Minimal and context-specific
- Sent via encrypted HTTPS to your provider
- Governed by your provider's privacy policy and terms
- Never stored or logged by Ratchet

## Network Activity

### Required Network Calls
Ratchet makes minimal network requests:

**License Validation**: A single API call to `api.ratchetcli.com` with your license key. No code or project information is transmitted.

**AI Provider Calls**: When generating fixes, code snippets are sent to your configured provider (Anthropic, OpenAI, etc.).

**Optional Features**:
- Badge/score uploads via `ratchet push` (explicit opt-in)
- npm package installation (standard registry behavior)

### No Telemetry
Ratchet does not collect analytics, usage metrics, or any form of telemetry. The only data we receive is your license validation request.

## Data Storage

### Local State
Ratchet creates a `.ratchet/` directory in your project root containing:
- Baseline configurations
- Scan results cache
- Git integration state
- Local settings

This directory is never uploaded or shared.

### No Cloud Storage
We don't maintain servers for processing or storing your code. There's no ratchetcli.com dashboard, no cloud database, and no persistent storage of your projects on our infrastructure.

## Enterprise Security

### Self-Hosted Option (Coming Soon)
For organizations with strict security requirements, we're building a completely air-gapped, self-hosted version:
- No external network dependencies
- Bring your own local LLM
- Full control over the entire stack
- No license validation required

*Self-hosted is currently in development. [Contact us](mailto:hello@ratchetcli.com) to join the early access list.*

### Git Integration Security
Ratchet's Git operations use your existing Git configuration and credentials. All commits, rollbacks, and branch operations are performed using your local Git setup with no external interference.

## Privacy Considerations

### Code Snippets
When requesting AI-generated fixes, only the necessary code context is sent to your provider. We don't transmit:
- Entire files unless required for context
- Sensitive configuration files
- Environment variables or secrets
- Comments containing personal information

### Provider Relationships
Your relationship with AI providers (Anthropic, OpenAI, etc.) is direct. Their privacy policies govern how they handle the code snippets you send. We recommend reviewing their terms to understand their data retention and usage policies.

## Security Best Practices

### For Teams
- Use environment-specific API keys with appropriate permissions
- Regularly rotate AI provider API keys
- Review and audit the `.ratchet/` directory in version control
- Consider the self-hosted option (coming soon) for highly sensitive codebases

### For Individuals
- Store API keys securely using your preferred secret management solution
- Be mindful of what code snippets you send for AI analysis
- Review AI-generated fixes before applying them
- Keep Ratchet updated for the latest security improvements

## Compliance & Auditing

### No Compliance Certifications Needed
Because Ratchet doesn't process or store your code on our servers, we don't require SOC 2, ISO 27001, or other cloud security certifications. Your code never touches our infrastructure.

### Transparency
The open-source scanner ([ratchet-oss](https://github.com/giovanni-labs/ratchet-oss), MIT licensed) is available for security review. The CLI operates transparently—you can inspect network traffic, review local storage, and verify that your code remains on your machine.

## Questions & Support

For security-related questions or concerns, please contact us at hello@ratchetcli.com. We're committed to transparency about our security architecture and happy to provide additional details for your security team's review.

---

*Last updated: March 2026*