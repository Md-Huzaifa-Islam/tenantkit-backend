import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length >= 2 ? slug : `workspace-${slug}`.replace(/-$/, '');
}

export function slugWithSuffix(base: string): string {
  return `${base.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
}
