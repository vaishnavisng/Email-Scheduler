import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  MeResponse,
  EmailListResponse,
  CreateCampaignResponse,
  CreateCampaignRequest,
} from '@outbox/shared';
import { api, ApiError, type EmailSearchParams } from './api';

/** The signed-in user + Slack state. Not retried on 401 — an expired session is
 * a definitive answer the middleware/login flow handles, not a transient error. */
export function useMe(): UseQueryResult<MeResponse, ApiError> {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: (count, err) =>
      err instanceof ApiError && err.status === 401 ? false : count < 2,
  });
}

/** The scheduled/sent tables. When `q` is set it hits /api/emails/search; otherwise
 * the plain list. refetchInterval keeps rows migrating scheduled→sent live during
 * a demo without a manual refresh. */
export function useEmails(
  params: EmailSearchParams,
): UseQueryResult<EmailListResponse, ApiError> {
  const q = params.q?.trim();
  return useQuery({
    queryKey: ['emails', params],
    queryFn: () => (q ? api.search({ ...params, q }) : api.emails(params)),
    refetchInterval: 5000,
    placeholderData: (prev) => prev, // keep rows visible across page/poll changes
  });
}

/** Compose submit. On success the caller invalidates the scheduled list so the new
 * rows appear immediately (before the 5s poll). */
export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation<CreateCampaignResponse, ApiError, CreateCampaignRequest>({
    mutationFn: api.createCampaign,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emails'] }),
  });
}

export function useLogout(): () => Promise<void> {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.clear(),
  });
  return () => mutation.mutateAsync();
}

/** Slack connect: fetch the authorize URL, then hand the browser to Slack. */
export function useSlackConnect(): () => Promise<void> {
  const mutation = useMutation({
    mutationFn: api.slackConnect,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  return () => mutation.mutateAsync().then(() => undefined);
}

export function useSlackDisconnect(): () => Promise<void> {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: api.slackDisconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return () => mutation.mutateAsync();
}
