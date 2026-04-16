import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_USER_ID = process.env.DEV_USER_ID ?? 'dev-user-1';
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? 'dev@joblog.local';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function main() {
  console.log(`Seeding dev user ${DEV_USER_ID}...`);

  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {},
    create: { id: DEV_USER_ID, email: DEV_USER_EMAIL },
  });

  // Wipe existing apps for the dev user so reseeding is idempotent
  await prisma.application.deleteMany({ where: { userId: DEV_USER_ID } });

  const seed = [
    {
      companyName: 'Shopify',
      roleTitle: 'Backend Engineer Intern',
      jobUrl: 'https://shopify.com/careers/12345',
      jdSnapshot: 'Build merchant-facing APIs in Ruby and Go...',
      status: 'APPLIED',
      source: 'linkedin',
      appliedAt: daysAgo(9),
      tags: ['Toronto', 'SWE'],
      location: 'Toronto, ON',
      isRemote: false,
      history: [{ fromStatus: null, toStatus: 'APPLIED', trigger: 'manual', changedAt: daysAgo(9) }],
    },
    {
      companyName: 'Stripe',
      roleTitle: 'Software Engineer, Payments',
      jobUrl: 'https://stripe.com/jobs/listing/9999',
      status: 'SCREENING',
      source: 'referral',
      appliedAt: daysAgo(12),
      contactName: 'Alex Kim',
      contactEmail: 'alex@stripe.com',
      tags: ['Remote', 'SWE'],
      location: 'Remote',
      isRemote: true,
      history: [
        { fromStatus: null, toStatus: 'APPLIED', trigger: 'manual', changedAt: daysAgo(12) },
        {
          fromStatus: 'APPLIED',
          toStatus: 'SCREENING',
          trigger: 'email_auto',
          triggerDetail: 'Recruiter screen request',
          changedAt: daysAgo(2),
        },
      ],
    },
    {
      companyName: 'Notion',
      roleTitle: 'Product Manager Intern',
      status: 'INTERVIEW',
      source: 'company_site',
      appliedAt: daysAgo(20),
      tags: ['SF', 'PM'],
      location: 'San Francisco, CA',
      isRemote: false,
      history: [
        { fromStatus: null, toStatus: 'APPLIED', trigger: 'manual', changedAt: daysAgo(20) },
        { fromStatus: 'APPLIED', toStatus: 'SCREENING', trigger: 'email_auto', changedAt: daysAgo(10) },
        { fromStatus: 'SCREENING', toStatus: 'INTERVIEW', trigger: 'manual', changedAt: daysAgo(4) },
      ],
    },
    {
      companyName: 'Vercel',
      roleTitle: 'DevOps Engineer',
      status: 'SAVED',
      source: 'job_board',
      tags: ['Remote', 'DevOps'],
      location: 'Remote',
      isRemote: true,
      history: [{ fromStatus: null, toStatus: 'SAVED', trigger: 'manual', changedAt: daysAgo(1) }],
    },
    {
      companyName: 'Anthropic',
      roleTitle: 'Member of Technical Staff',
      status: 'OFFER',
      source: 'cold_email',
      appliedAt: daysAgo(30),
      tags: ['SF', 'SWE', 'Dream'],
      location: 'San Francisco, CA',
      isRemote: false,
      history: [
        { fromStatus: null, toStatus: 'APPLIED', trigger: 'manual', changedAt: daysAgo(30) },
        { fromStatus: 'APPLIED', toStatus: 'INTERVIEW', trigger: 'email_auto', changedAt: daysAgo(15) },
        { fromStatus: 'INTERVIEW', toStatus: 'FINAL_ROUND', trigger: 'manual', changedAt: daysAgo(7) },
        { fromStatus: 'FINAL_ROUND', toStatus: 'OFFER', trigger: 'email_auto', changedAt: daysAgo(1) },
      ],
    },
    {
      companyName: 'Figma',
      roleTitle: 'Frontend Engineer',
      status: 'APPLIED',
      source: 'linkedin',
      appliedAt: daysAgo(6),
      tags: ['NYC', 'SWE'],
      location: 'New York, NY',
      isRemote: false,
      history: [
        { fromStatus: null, toStatus: 'APPLIED', trigger: 'manual', changedAt: daysAgo(6) },
        {
          fromStatus: 'APPLIED',
          toStatus: 'APPLIED',
          trigger: 'email_auto',
          triggerDetail: 'Auto-reply received',
          changedAt: daysAgo(5),
        },
      ],
    },
  ];

  for (const s of seed) {
    const { history, ...rest } = s;
    await prisma.application.create({
      data: {
        ...rest,
        userId: DEV_USER_ID,
        history: { create: history },
      },
    });
  }

  console.log(`Seeded ${seed.length} applications.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
