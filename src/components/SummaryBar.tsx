import { useApplicationStore } from '@/store/applicationStore';

export function SummaryBar() {
  const apps = useApplicationStore((s) => s.applications);
  const total = apps.length;
  const responded = apps.filter((a) =>
    ['ACKNOWLEDGED', 'SCREENING', 'INTERVIEW', 'FINAL_ROUND', 'OFFER', 'ACCEPTED', 'REJECTED'].includes(a.status),
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {s.label}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</div>
        </div>
      ))}
    </div>
  );
}
