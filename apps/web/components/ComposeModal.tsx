'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { FileDropzone } from '@/components/ui/FileDropzone';
import { useToast } from '@/components/ui/Toast';
import { useCreateCampaign } from '@/lib/queries';
import { parseLeads, type ParsedLeads } from '@/lib/parse-leads';

/** A Date → <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm") in local time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart(): string {
  return toLocalInput(new Date(Date.now() + 2 * 60_000)); // 2 min out
}

export function ComposeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateCampaign();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startAt, setStartAt] = useState(defaultStart);
  const [delaySec, setDelaySec] = useState('5');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [leads, setLeads] = useState<ParsedLeads | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setSubject('');
    setBody('');
    setStartAt(defaultStart());
    setDelaySec('5');
    setHourlyLimit('');
    setLeads(null);
    setFileName(null);
    setErrors({});
  };

  const onFiles = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setFileName(file.name);
    setLeads(parseLeads(await file.text()));
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!subject.trim()) e.subject = 'Subject is required.';
    if (!body.trim()) e.body = 'Body is required.';
    if (!leads || leads.valid.length === 0)
      e.leads = 'Upload a CSV/TXT with at least one valid email.';
    if (!startAt || new Date(startAt).getTime() <= Date.now())
      e.startAt = 'Start time must be in the future.';
    const delay = Number(delaySec);
    if (!Number.isFinite(delay) || delay < 0)
      e.delaySec = 'Delay must be zero or more seconds.';
    if (hourlyLimit !== '') {
      const h = Number(hourlyLimit);
      if (!Number.isInteger(h) || h <= 0)
        e.hourlyLimit = 'Hourly limit must be a positive whole number.';
    }
    return e;
  };

  const submit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0 || !leads) return;

    try {
      const res = await create.mutateAsync({
        subject: subject.trim(),
        body,
        startAt: new Date(startAt).toISOString(),
        delayMs: Number(delaySec) * 1000,
        recipients: leads.valid,
        hourlyLimit: hourlyLimit === '' ? null : Number(hourlyLimit),
      });
      toast(`Scheduled ${res.totalRecipients} email(s).`, 'success');
      reset();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to schedule.', 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose New Email"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          error={errors.subject}
          placeholder="Your subject line"
        />
        <Textarea
          label="Body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={errors.body}
          placeholder="Write your message…"
          className="min-h-32"
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Recipients</span>
          <FileDropzone
            onFiles={onFiles}
            accept=".csv,.txt,text/csv,text/plain"
            hint="CSV or TXT — emails are extracted, deduped and validated"
          />
          {fileName && leads && (
            <div className="mt-1 text-sm">
              <p className="text-ink-muted">
                <span className="font-medium text-ink">{fileName}</span>:{' '}
                <span className="text-success">{leads.valid.length} valid</span>
                {leads.duplicates > 0 && ` · ${leads.duplicates} duplicate(s) removed`}
                {leads.invalid.length > 0 && (
                  <span className="text-danger">
                    {' '}
                    · {leads.invalid.length} invalid
                  </span>
                )}
              </p>
              {leads.invalid.length > 0 && (
                <p className="mt-0.5 break-words text-xs text-danger">
                  Invalid: {leads.invalid.slice(0, 10).join(', ')}
                  {leads.invalid.length > 10 && ` +${leads.invalid.length - 10} more`}
                </p>
              )}
            </div>
          )}
          {errors.leads && <p className="text-sm text-danger">{errors.leads}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Start time"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            error={errors.startAt}
          />
          <Input
            label="Delay (seconds)"
            type="number"
            min={0}
            value={delaySec}
            onChange={(e) => setDelaySec(e.target.value)}
            error={errors.delaySec}
          />
          <Input
            label="Hourly limit"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(e.target.value)}
            error={errors.hourlyLimit}
            placeholder="Optional"
          />
        </div>
      </div>
    </Modal>
  );
}
