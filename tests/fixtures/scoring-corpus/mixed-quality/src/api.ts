// Mixed quality: some good patterns, some bad

export interface User {
  id: string;
  name: string;
  email: string;
}

export async function getUser(id: string): Promise<User> {
  try {
    const res = await fetch(`/api/users/${id}`);
    return res.json() as Promise<User>;
  } catch {}
  return { id: '', name: '', email: '' };
}

export async function getAllUsers(): Promise<User[]> {
  try {
    const res = await fetch('/api/users');
    return res.json() as Promise<User[]>;
  } catch {}
  return [];
}

export function formatUser(user: any): string {
  console.log('Formatting user:', user);
  return `${user.name} <${user.email}>`;
}

export function parseConfig(raw: any): Record<string, any> {
  // TODO: add validation here
  // FIXME: handle parse errors
  console.log('Parsing config');
  return JSON.parse(raw);
}

export function processItems(items: any[]): void {
  // TODO: optimize this
  for (const item of items) {
    console.log('Processing:', item);
  }
}

export async function saveUser(user: any): Promise<void> {
  try {
    await fetch('/api/users', { method: 'POST', body: JSON.stringify(user) });
  } catch {}
  console.log('Saved user');
}

export function transform(data: any): any {
  console.log('transforming', data);
  return data;
}
