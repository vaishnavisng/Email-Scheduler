import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { MeResponse, EmailListResponse } from '@outbox/shared';
import { api, ApiError, type EmailListParams } from './api';

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

export function useEmails(
  params: EmailListParams,
): UseQueryResult<EmailListResponse, ApiError> {
  return useQuery({
    queryKey: ['emails', params],
    queryFn: () => api.emails(params),
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
