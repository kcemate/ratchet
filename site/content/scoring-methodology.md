# Ratchet Scoring Methodology

Ratchet analyzes TypeScript/JavaScript codebases across six critical dimensions, awarding up to 100 points based on code quality, security, and maintainability. Our scoring engine uses regex detection followed by AST confirmation, with code context stripped of comments and strings for accurate analysis.

## Testing (25 points)

**What we measure:** Test file ratio and test case density relative to codebase size.

**How it's scored:** Ratchet measures the ratio of test files to source files and the density of test cases per 1000 lines of code. Higher ratios and denser test suites score higher. This is based on file counts and test case density — not runtime code coverage percentages.

**Scores 0:**
```javascript
// No test files found
// src/userService.js
export function createUser(email, password) {
  return db.query(`INSERT INTO users VALUES ('${email}', '${password}')`);
}
```

**Scores full marks:**
```javascript
// src/userService.js
export function createUser(email, password) {
  validateEmail(email);
  validatePassword(password);
  return db.query('INSERT INTO users VALUES (?, ?)', [email, hashPassword(password)]);
}

// tests/userService.test.js
import { createUser } from '../src/userService.js';

describe('createUser', () => {
  it('should create user with valid email and password', async () => {
    const result = await createUser('test@example.com', 'securePass123!');
    expect(result.success).toBe(true);
  });
  
  it('should reject invalid email format', async () => {
    await expect(createUser('invalid', 'password')).rejects.toThrow('Invalid email');
  });
  
  it('should hash password before storage', async () => {
    const result = await createUser('test@example.com', 'password');
    expect(result.password).not.toBe('password');
  });
});
```

## Security (15 points)

### Secrets Detection (3 points)
**What we measure:** Hardcoded API keys, tokens, and credentials.

**Scores 0:**
```javascript
const API_KEY = 'sk-1234567890abcdef';
const DB_PASSWORD = 'supersecret123';
const JWT_SECRET = 'myjwtsecret';
```

**Scores full marks:**
```javascript
const API_KEY = process.env.API_KEY;
const DB_PASSWORD = process.env.DB_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

if (!API_KEY || !DB_PASSWORD || !JWT_SECRET) {
  throw new Error('Missing required environment variables');
}
```

### Input Validation (6 points)
**What we measure:** Proper validation of user inputs before processing.

**Scores 0:**
```javascript
app.post('/api/users', (req, res) => {
  const { email, age } = req.body;
  // No validation - direct usage
  db.query(`SELECT * FROM users WHERE email = '${email}' AND age = ${age}`);
});
```

**Scores full marks:**
```javascript
import { z } from 'zod';

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18).max(120)
});

app.post('/api/users', async (req, res) => {
  try {
    const { email, age } = userSchema.parse(req.body);
    await db.query('SELECT * FROM users WHERE email = ? AND age = ?', [email, age]);
  } catch (error) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
  }
});
```

### Authentication Patterns (6 points)
**What we measure:** Proper middleware usage, rate limiting, and scope validation.

**Scores 0:**
```javascript
app.get('/admin/users', (req, res) => {
  // No auth check
  return db.query('SELECT * FROM users');
});
```

**Scores full marks:**
```javascript
import rateLimit from 'express-rate-limit';

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

app.get('/admin/users', adminLimiter, requireAdmin, async (req, res) => {
  try {
    const users = await db.query('SELECT id, email, role FROM users');
    res.json(users);
  } catch (error) {
    logger.error('Failed to fetch users', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

## Type Safety (15 points)

### TypeScript Configuration (7 points)
**What we measure:** Strict mode enabled in tsconfig.json.

**Scores 0:**
```json
{
  "compilerOptions": {
    "strict": false,
    "noImplicitAny": false,
    "strictNullChecks": false
  }
}
```

**Scores full marks:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

### Explicit Types (8 points)
**What we measure:** Explicit return types and avoidance of `any` type.

**Scores 0:**
```typescript
function processData(data: any): any {
  return data.map((item: any) => {
    return item.value;
  });
}
```

**Scores full marks:**
```typescript
interface DataItem {
  id: number;
  value: string;
  timestamp: Date;
}

interface ProcessedItem {
  id: number;
  value: string;
  age: number;
}

function processData(data: DataItem[]): ProcessedItem[] {
  return data.map((item): ProcessedItem => {
    const age = Date.now() - item.timestamp.getTime();
    return {
      id: item.id,
      value: item.value,
      age
    };
  });
}
```

## Error Handling (20 points)

### Empty Catch Blocks (5 points)
**What we measure:** Catch blocks that swallow errors without handling or logging.

**Scores 0:**
```javascript
try {
  await riskyOperation();
} catch (error) {
  // Silently ignore
}
```

**Scores full marks:**
```javascript
try {
  await riskyOperation();
} catch (error) {
  logger.error('Risky operation failed', { 
    error: error.message,
    stack: error.stack,
    context: 'userRegistration'
  });
  throw new UserRegistrationError('Failed to complete registration');
}
```

### Structured Logging (7 points)
**What we measure:** Use of structured logging libraries vs console.log.

**Scores 0:**
```javascript
console.log('User created');
console.log('User:', user);
console.error('Something went wrong');
```

**Scores full marks:**
```javascript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  }
});

logger.info({
  event: 'user_created',
  userId: user.id,
  email: user.email,
  timestamp: new Date().toISOString()
});

logger.error({
  event: 'user_creation_failed',
  error: error.message,
  stack: error.stack,
  userEmail: email
});
```

### Error Propagation (8 points)
**What we measure:** Proper error propagation through the call stack.

**Scores 0:**
```javascript
async function fetchUserData(userId) {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    return user;
  } catch (error) {
    return null; // Swallows the error
  }
}
```

**Scores full marks:**
```javascript
class DatabaseError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

async function fetchUserData(userId) {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new NotFoundError(`User ${userId} not found`);
    }
    return user;
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    throw new DatabaseError('Failed to fetch user data', error);
  }
}
```

## Performance (10 points)

### Async Patterns (3 points)
**What we measure:** Proper use of async/await vs blocking operations.

**Scores 0:**
```javascript
function processUsers(userIds) {
  const results = [];
  userIds.forEach(id => {
    const user = db.query('SELECT * FROM users WHERE id = ?', [id]); // Blocking
    results.push(user);
  });
  return results;
}
```

**Scores full marks:**
```javascript
async function processUsers(userIds) {
  const promises = userIds.map(id => 
    db.query('SELECT * FROM users WHERE id = ?', [id])
  );
  return Promise.all(promises);
}
```

### Console in Production (5 points)
**What we measure:** Console statements in production code.

**Scores 0:**
```javascript
if (process.env.NODE_ENV === 'production') {
  console.log('Production server started');
  console.time('api-call');
  const data = await fetchData();
  console.timeEnd('api-call');
}
```

**Scores full marks:**
```javascript
if (process.env.NODE_ENV === 'production') {
  logger.info('Production server started');
  const startTime = Date.now();
  const data = await fetchData();
  logger.debug('API call completed', { duration: Date.now() - startTime });
}
```

### Bundle Patterns (2 points)
**What we measure:** Efficient import patterns and tree-shaking.

**Scores 0:**
```javascript
import _ from 'lodash';
const result = _.pick(obj, ['name', 'email']);
```

**Scores full marks:**
```javascript
import pick from 'lodash/pick';
const result = pick(obj, ['name', 'email']);
```

## Code Quality (15 points)

### Dead Code (4 points)
**What we measure:** Unused variables, functions, and imports.

**Scores 0:**
```javascript
import { unusedHelper } from './helpers';

const unusedVariable = 42;

function oldFunction() {
  // This function is never called
  return 'deprecated';
}

export function activeFunction() {
  return 'in use';
}
```

**Scores full marks:**
```javascript
export function activeFunction() {
  return 'in use';
}
```

### Code Duplication (3 points)
**What we measure:** Repeated code blocks across the codebase.

**Scores 0:**
```javascript
// File 1
function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// File 2
function checkEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}
```

**Scores full marks:**
```javascript
// utils/validation.js
export const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email) {
  return emailRegex.test(email);
}

// File 1
import { validateEmail } from '../utils/validation';

// File 2
import { validateEmail } from '../utils/validation';
```

### Function Length (4 points)
**What we measure:** Functions exceeding 50 lines.

**Scores 0:**
```javascript
function processOrder(order) {
  // 80+ lines of code handling validation, inventory check, payment processing,
  // email sending, logging, and error handling all in one function
}
```

**Scores full marks:**
```javascript
async function processOrder(order) {
  const validatedOrder = await validateOrder(order);
  const inventoryAvailable = await checkInventory(validatedOrder);
  if (!inventoryAvailable) {
    throw new InsufficientInventoryError();
  }
  
  const payment = await processPayment(validatedOrder);
  await updateInventory(validatedOrder);
  await sendConfirmationEmail(validatedOrder);
  
  logger.info('Order processed successfully', { orderId: order.id });
  return payment;
}
```

### Line Length (4 points)
**What we measure:** Lines exceeding 120 characters.

**Scores 0:**
```javascript
const user = await db.query('SELECT u.id, u.name, u.email, u.created_at, u.updated_at, p.bio, p.avatar_url FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.id = ? AND u.status = "active"', [userId]);
```

**Scores full marks:**
```javascript
const user = await db.query(`
  SELECT u.id, u.name, u.email, u.created_at, u.updated_at, 
         p.bio, p.avatar_url 
  FROM users u 
  LEFT JOIN profiles p ON u.id = p.user_id 
  WHERE u.id = ? AND u.status = "active"
`, [userId]);
```

## How Scoring Works

Ratchet calculates issue density per 1000 lines of code, not raw counts. This ensures fair comparison between codebases of different sizes. Each dimension is weighted based on its impact on code quality and maintainability.

**File Classification:**
- **PRODUCTION:** Source code that runs in production
- **TEST:** Test files and testing utilities
- **DOCS:** Documentation and examples
- **CONFIG:** Configuration files

Only PRODUCTION and TEST files contribute to scoring. Issues are detected through regex patterns and confirmed via AST parsing for accuracy. Code context is stripped of comments and strings to avoid false positives.

A score of 90+ indicates excellent code quality worthy of production deployment. 70-89 suggests good practices with room for improvement. Below 70 indicates significant technical debt requiring attention.