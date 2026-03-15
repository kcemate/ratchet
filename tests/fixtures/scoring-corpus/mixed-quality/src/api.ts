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
  // TODO: add validation
  console.log('Parsing config');
  return JSON.parse(raw);
}

export function processItems(items: any[]): void {
  // FIXME: this is slow
  for (const item of items) {
    console.log('Processing:', item);
  }
}
