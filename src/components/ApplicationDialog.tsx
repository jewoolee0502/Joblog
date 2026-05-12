import { useEffect, useState } from 'react';
import type { Application, ApplicationSource, ApplicationStatus } from '@/types';
import { APPLICATION_SOURCES, APPLICATION_STATUSES, STATUS_LABELS } from '@/types';
import { useApplicationStore } from '@/store/applicationStore';

type Mode = 'create' | 'edit';

interface Props {
  open: boolean;
  mode: Mode;
  initialStatus?: ApplicationStatus;
  application?: Application | null;
  onClose: () => void;
}

interface FormState {
  companyName: string;
  roleTitle: string;
  jobUrl: string;
  jdSnapshot: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  contactName: string;
  contactEmail: string;
  notes: string;
  salaryRange: string;
  location: string;
  isRemote: boolean;
  tagsRaw: string;
}

const empty = (status: ApplicationStatus = 'SAVED'): FormState => ({
  companyName: '',
  roleTitle: '',
  jobUrl: '',
  jdSnapshot: '',
  status,
  source: 'other',
  contactName: '',
  contactEmail: '',
  notes: '',
  salaryRange: '',
  location: '',
  isRemote: false,
  tagsRaw: '',
});

const fromApp = (a: Application): FormState => ({
  companyName: a.companyName,
  roleTitle: a.roleTitle,
  jobUrl: a.jobUrl ?? '',
  jdSnapshot: a.jdSnapshot ?? '',
  status: a.status,
  source: a.source,
  contactName: a.contactName ?? '',
  contactEmail: a.contactEmail ?? '',
  notes: a.notes ?? '',
  salaryRange: a.salaryRange ?? '',
  location: a.location ?? '',
  isRemote: a.isRemote ?? false,
  tagsRaw: (a.tags ?? []).join(', '),
});

export function ApplicationDialog({ open, mode, initialStatus, application, onClose }: Props) {
  const createApplication = useApplicationStore((s) => s.createApplication);
  const updateApplication = useApplicationStore((s) => s.updateApplication);
  const deleteApplication = useApplicationStore((s) => s.deleteApplication);

  const [form, setForm] = useState<FormState>(empty(initialStatus));

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && application) setForm(fromApp(application));
    else setForm(empty(initialStatus));
  }, [open, mode, application, initialStatus]);

  if (!open) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const base = {
      companyName: form.companyName.trim(),
      roleTitle: form.roleTitle.trim(),
      jobUrl: form.jobUrl.trim() || undefined,
      jdSnapshot: form.jdSnapshot.trim() || undefined,
      source: form.source,
      contactName: form.contactName.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      notes: form.notes.trim() || undefined,
      salaryRange: form.salaryRange.trim() || undefined,
      location: form.location.trim() || undefined,
      isRemote: form.isRemote,
      tags,
      status: form.status,
    };

    if (!base.companyName || !base.roleTitle) return;

    if (mode === 'create') {
      await createApplication({
        ...base,
        appliedAt: form.status === 'APPLIED' ? new Date().toISOString() : undefined,
      });
    } else if (application) {
      await updateApplication(application.id, base);
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!application) return;
    if (!confirm(`Delete application for ${application.companyName}?`)) return;
    await deleteApplication(application.id);
    onClose();
  };

  return (
    <div
      className="backdrop-fade-in fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'oklch(0.08 0.01 240 / 0.7)' }}
      onClick={onClose}
    >
      <div
        className="dialog-scale-in max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border-subtle bg-dark-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
            <h2 className="text-base font-semibold text-content-primary">
              {mode === 'create' ? 'New Application' : 'Edit Application'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-content-tertiary transition-colors duration-150 hover:bg-dark-surface hover:text-content-primary"
              aria-label="Close"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2">
            <Field label="Company *">
              <input
                required
                value={form.companyName}
                onChange={(e) => update('companyName', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Role title *">
              <input
                required
                value={form.roleTitle}
                onChange={(e) => update('roleTitle', e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => update('status', e.target.value as ApplicationStatus)}
                className={inputCls}
              >
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <select
                value={form.source}
                onChange={(e) => update('source', e.target.value as ApplicationSource)}
                className={inputCls}
              >
                {APPLICATION_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Job URL" className="sm:col-span-2">
              <input
                type="url"
                value={form.jobUrl}
                onChange={(e) => update('jobUrl', e.target.value)}
                className={inputCls}
                placeholder="https://"
              />
            </Field>

            <Field label="Location">
              <input
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Salary range">
              <input
                value={form.salaryRange}
                onChange={(e) => update('salaryRange', e.target.value)}
                className={inputCls}
                placeholder="$120k-$150k"
              />
            </Field>

            <Field label="Contact name">
              <input
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Contact email">
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => update('contactEmail', e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Source email" className="sm:col-span-2">
              {application?.emailUrl ? (
                <a
                  href={application.emailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-sm text-accent hover:text-accent-hover"
                >
                  Open in inbox
                </a>
              ) : (
                <span className="text-sm text-content-tertiary">No email linked</span>
              )}
            </Field>

            <Field label="Tags (comma separated)" className="sm:col-span-2">
              <input
                value={form.tagsRaw}
                onChange={(e) => update('tagsRaw', e.target.value)}
                className={inputCls}
                placeholder="Toronto, SWE, Referral"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-content-secondary sm:col-span-2">
              <input
                type="checkbox"
                checked={form.isRemote}
                onChange={(e) => update('isRemote', e.target.checked)}
                className="rounded border-border accent-accent"
              />
              Remote
            </label>

            <Field label="JD snapshot" className="sm:col-span-2">
              <textarea
                value={form.jdSnapshot}
                onChange={(e) => update('jdSnapshot', e.target.value)}
                className={`${inputCls} min-h-[80px]`}
                placeholder="Paste the job description so you can reference it later."
              />
            </Field>

            <Field label="Notes" className="sm:col-span-2">
              <textarea
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                className={`${inputCls} min-h-[60px]`}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle px-6 py-4">
            <div>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-stage-rejected"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 hover:bg-dark-overlay hover:text-content-primary"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-content-primary px-4 py-2 text-sm font-medium text-dark-base transition-colors duration-150 hover:opacity-90"
              >
                {mode === 'create' ? 'Create' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-border-subtle bg-dark-surface px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent transition-colors duration-150';

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm ${className ?? ''}`}>
      <span className="text-xs font-medium text-content-secondary">{label}</span>
      {children}
    </label>
  );
}
