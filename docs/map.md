# Ratchet Map — GitNexus Knowledge Graph

> **Interactive dependency mapping and impact analysis.** Build a semantic knowledge graph of your codebase to visualize dependencies, analyze blast radius, and query relationships with Cypher.

## Overview

`ratchet map` is a powerful knowledge graph management system built on GitNexus. It creates a semantic graph of your codebase that captures:

- File dependencies and call relationships
- Data flow between modules
- Impact propagation paths
- Code ownership and authorship patterns

This enables advanced analysis like:
- **Blast radius analysis** — see exactly what breaks if you change a file
- **Dependency clusters** — visualize modular boundaries
- **Raw Cypher queries** — ask complex questions about your codebase structure

## Subcommands

### `ratchet map status`

Show the current indexing status of GitNexus for this repository.

```bash
$ ratchet map status

  ✓ GitNexus is indexed
  Last indexed: 2 minutes ago
  Files indexed: 142
```

### `ratchet map index`

Build or rebuild the knowledge graph by indexing the entire repository.

```bash
$ ratchet map index

  Indexing repository with GitNexus...
  ✓ Indexing complete
```

**Options:**
- `--force` — Force reindex even if already indexed

### `ratchet map query <cypher>`

Run a raw Cypher query against the knowledge graph.

```bash
$ ratchet map query "MATCH (n:File) WHERE n.path CONTAINS 'auth' RETURN n"

  [
    {
      "path": "src/auth/index.ts",
      "name": "index.ts",
      "type": "ts",
      "lines": 245
    },
    {
      "path": "src/auth/jwt.ts",
      "name": "jwt.ts",
      "type": "ts",
      "lines": 189
    }
  ]
```

**Arguments:**
- `<cypher>` — Valid Cypher query string

### `ratchet map impact <target>`

Analyze the detailed blast radius for a specific file or symbol.

```bash
$ ratchet map impact "src/utils/logger.ts"

  Risk Level:    HIGH
  Confidence:    92%
  Dependents:    8

  Direct Callers (3):
    • src/auth/jwt.ts
    • src/api/middleware.ts
    • src/main.ts

  Affected Files (5):
    • src/auth/jwt.ts
    • src/api/middleware.ts
    • src/main.ts
    • src/tests/logger.test.ts
    • src/docs/api-reference.md
```

**Arguments:**
- `<target>` — File path or symbol name to analyze

### `ratchet map clusters`

Show dependency clusters for the entire codebase.

```bash
$ ratchet map clusters

  Cluster 1 (Core):
    • src/main.ts
    • src/config.ts
    • src/logger.ts

  Cluster 2 (Auth):
    • src/auth/index.ts
    • src/auth/jwt.ts
    • src/auth/middleware.ts

  Cluster 3 (API):
    • src/api/routes.ts
    • src/api/middleware.ts
    • src/api/validators.ts
```

## Common Workflows

### Initial Setup

```bash
# 1. Index your repository
ratchet map index

# 2. Verify indexing worked
ratchet map status

# 3. Start querying dependencies
ratchet map query "MATCH (n) RETURN n LIMIT 10"
```

### Impact Analysis Before Refactoring

```bash
# Check what breaks if you modify a utility function
ratchet map impact "src/utils/helpers.ts"

# Check the impact of changing an API endpoint
ratchet map impact "src/api/routes/auth.ts"
```

### Understanding Code Structure

```bash
# Find all files that depend on a specific module
ratchet map query "MATCH (f:File)-[r:DEPENDS_ON]->(m:Module) WHERE m.name='logger' RETURN f"

# Identify highly connected files (high risk)
ratchet map query "MATCH (f:File) WHERE size((f)-[:DEPENDS_ON]->()) > 10 RETURN f"
```

## Advanced Usage

### Custom Cypher Queries

The GitNexus graph schema includes:

- **Nodes:** `File`, `Module`, `Function`, `Class`, `Symbol`
- **Relationships:** `DEPENDS_ON`, `CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`

Example queries:

```cypher
# Find all circular dependencies
MATCH (a)-[:DEPENDS_ON]->(b)-[:DEPENDS_ON]->(a)
WHERE a <> b
RETURN a.path, b.path

# Find files with high coupling
MATCH (f:File)
OPTIONAL MATCH (f)-[r:DEPENDS_ON]->(other)
RETURN f.path, count(r) as dependencyCount
ORDER BY dependencyCount DESC
LIMIT 10

# Find orphaned modules (no tests)
MATCH (m:Module)
OPTIONAL MATCH (m)-[:HAS_TEST]->()
WHERE NOT (m)-[:HAS_TEST]-()
RETURN m.name
```

### Integration with Ratchet Torque

Use the knowledge graph during automated improvement loops:

```bash
# Run impact analysis before each click
ratchet torque --target src --clicks 3 --pre-check "ratchet map impact src"
```

## Troubleshooting

**"GitNexus is not indexed" error:**
```bash
# Run indexing first
ratchet map index
```

**Query returns no results:**
- Make sure indexing completed successfully
- Check that your Cypher syntax is valid
- Verify the target file paths match what's in the graph

**Performance issues with large repositories:**
- Indexing can take several minutes for large codebases
- Consider indexing incrementally with --force flag
- Query specific subgraphs instead of the entire graph

## See Also

- [Ratchet Torque](./torque.md) — Iterative improvement engine
- [GitNexus Documentation](https://github.com/gitnexus/gitnexus) — Underlying graph database
- [Cypher Query Language](https://neo4j.com/docs/cypher-manual/) — Graph query language

## Examples

```bash
# Quick status check
ratchet map status

# Rebuild graph after major changes
ratchet map index --force

# Analyze impact of changing database schema
ratchet map impact "src/models/user.ts"

# Find all files that import a deprecated module
ratchet map query "MATCH (f:File)-[:IMPORTS]->(m:Module) WHERE m.name='old-lib' RETURN f"
```
