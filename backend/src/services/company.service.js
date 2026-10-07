import { badRequest } from '../utils/errors.js';

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toCompanyDto(company) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    website: company.website,
    logoUrl: company.logoUrl,
  };
}

/** Finds the company by id, or by normalised name (creating it if new). */
export async function resolveCompany(db, { companyId, companyName }) {
  if (companyId) {
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) throw badRequest('Unknown company', [{ path: 'companyId', message: 'Company not found' }]);
    return company;
  }

  const slug = slugify(companyName);
  if (!slug) throw badRequest('Invalid company name', [{ path: 'companyName', message: 'Enter a company name' }]);
  return db.company.upsert({ where: { slug }, create: { name: companyName, slug }, update: {} });
}

export function createCompanyService({ prisma }) {
  return {
    async search({ q, limit }) {
      const companies = await prisma.company.findMany({
        where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
        orderBy: { name: 'asc' },
        take: limit,
      });
      return companies.map(toCompanyDto);
    },
  };
}
