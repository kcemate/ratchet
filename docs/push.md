# Push Command

The `ratchet push` command uploads your latest scan results to the Ratchet cloud platform, enabling:

- Centralized dashboard for all your projects
- Historical trend analysis
- Team sharing and collaboration
- Automated PR generation with security insights

## Basic Usage

```bash
# Push the current directory's scan results
ratchet push

# Push a specific project directory
ratchet push /path/to/project
```

## Command Options

```bash
ratchet push [dir] [options]
```

| Option | Description |
|--------|-------------|
| `[dir]` | Project directory (default: current directory) |
| `--no-auto-pr` | Skip auto-PR creation even if this is the first push |

## Authentication Requirements

The push command requires Ratchet Pro access:

```bash
# Install Ratchet Pro
npm install -g ratchet-pro

# Login with your API key
ratchet auth login --api-key <your-api-key>
```

## Workflow Integration

### 1. Run a Scan First

```bash
ratchet scan
```

This generates a scan cache file at `.ratchet/scan-cache.json` which contains your security scores and findings.

### 2. Push to Cloud

```bash
ratchet push
```

The command automatically reads the cached scan results and uploads them.

### 3. Optional: Auto-PR Creation

On first push to a new project, Ratchet can automatically create a pull request with:

- Before/after score card
- Detailed findings summary
- Recommended improvement plan

Control this behavior with `--no-auto-pr`:

```bash
ratchet push --no-auto-pr
```

## Examples

### Basic Push

```bash
cd ~/Projects/my-app
ratchet scan
ratchet push
```

### Push with No Auto-PR

```bash
ratchet push --no-auto-pr
```

### Push a Specific Directory

```bash
ratchet push ~/Projects/legacy-project
```

## Error Handling

### Missing Scan Cache

If you haven't run a scan recently, you'll see:

```
Error: No scan cache found at .ratchet/scan-cache.json
```

Run `ratchet scan` first to generate the cache.

### Authentication Failed

If you haven't installed Ratchet Pro or logged in:

```
The `push` command requires Ratchet Pro.
  npm install -g ratchet-pro
  ratchet auth login --api-key <key>
```

### Network Issues

The command will retry automatically on transient network failures.

## Best Practices

1. **Run scans regularly** - Include `ratchet scan` in your CI/CD pipeline
2. **Push after scans** - Keep your cloud dashboard up to date
3. **Use auto-PR strategically** - Enable it for new projects to establish baselines
4. **Monitor trends** - Use the Ratchet dashboard to track security improvements over time

## Related Commands

- `ratchet scan` - Generate security scan results
- `ratchet auth login` - Authenticate with Ratchet Pro
- `ratchet status` - Check current project status
- `ratchet torque` - Run autonomous improvements

## Troubleshooting

**"Requires Ratchet Pro" error**: Install the pro version with `npm install -g ratchet-pro` and login.

**"No scan cache found"**: Run `ratchet scan` to generate scan results before pushing.

**"Permission denied"**: Ensure your API key has push permissions in your Ratchet Pro account.

## Security Considerations

- Your scan data is encrypted in transit and at rest
- API keys are stored locally in your system keychain
- Never commit `.ratchet/` directory to version control
- Use project-specific API keys when working with multiple teams

## Version History

- **1.0.0** - Initial push implementation with cloud storage
- **1.1.0** - Added auto-PR creation and team sharing features
- **1.2.0** - Improved error handling and retry logic
