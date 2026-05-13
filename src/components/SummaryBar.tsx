import { useApplicationStore } from '@/store/applicationStore';

const STAT_ACCENTS = [
  'border-t-content-tertiary',
  'border-t-accent',
  'border-t-stage-screening',
  'border-t-stage-interview',
  'border-t-stage-offer',
];

export function SummaryBar() {
  const apps = useApplicationStore((s) => s.applications);
  const total = apps.length;
  const responded = apps.filter((a) =>
    ['SCREENING', 'INTERVIEW', 'FINAL_ROUND', 'OFFER', 'ACCEPTED', 'REJECTED'].includes(a.status),
  ).length;
  const interviews = apps.filter((a) =>
    ['INTERVIEW', 'FINAL_ROUND', 'OFFER', 'ACCEPTED'].includes(a.status),
  ).length;
  const offers = apps.filter((a) => ['OFFER', 'ACCEPTED'].includes(a.status)).length;
  const submitted = apps.filter((a) => a.status !== 'SAVED').length;

  const responseRate = submitted ? Math.round((responded / submitted) * 100) : 0;
  const interviewRate = submitted ? Math.round((interviews / submitted) * 100) : 0;

  const stats = [
    { label: 'Total', value: total },
    { label: 'Submitted', value: submitted },
    { label: 'Response rate', value: `${responseRate}%` },
    { label: 'Interview rate', value: `${interviewRate}%` },
    { label: 'Offers', value: offers },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`rounded-lg border border-t-2 ${STAT_ACCENTS[i]} border-border-subtle bg-dark-raised px-4 py-3 transition-all duration-150 hover:bg-dark-surface`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-content-tertiary">
            {s.label}
          </div>
          <div className="mt-1 text-xl font-semibold text-content-primary">{s.value}</div>
        </div>
      ))}
    </div>
  );
}
