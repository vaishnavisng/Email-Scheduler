-- Atomic per-sender throttle + hourly-quota check-and-reserve.
--
-- Correctness across N worker instances requires the check and the reservation
-- to be one indivisible step: a JS-side GET -> decide -> INCR races between
-- workers and over-sends. This runs inside Redis, so it can't interleave.
--
-- KEYS[1] = throttle:{senderId}          last send timestamp (ms)
-- KEYS[2] = quota:{senderId}:{window}    per-sender count this window
-- KEYS[3] = quota:global:{window}        global count this window
-- ARGV    = now, minDelay, limit, ttl, globalLimit   (globalLimit 0 => disabled)
--
-- Returns {ok, reason, waitMs}: reason OK | THROTTLE | QUOTA.
--   QUOTA    -> per-sender or global count is spent for this window (re-park to next window)
--   THROTTLE -> too soon after the last send (re-park by waitMs)
-- A slot is reserved (counters incremented, last-send stamped) ONLY when both gates pass.

local now = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local globalLimit = tonumber(ARGV[5])

local used = tonumber(redis.call('GET', KEYS[2]) or 0)
if used >= limit then return {0, 'QUOTA', 0} end

if globalLimit > 0 then
  local gused = tonumber(redis.call('GET', KEYS[3]) or 0)
  if gused >= globalLimit then return {0, 'QUOTA', 0} end
end

local last = tonumber(redis.call('GET', KEYS[1]) or 0)
local earliest = last + minDelay
if now < earliest then return {0, 'THROTTLE', earliest - now} end

redis.call('SET', KEYS[1], now)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ttl)
if globalLimit > 0 then
  redis.call('INCR', KEYS[3])
  redis.call('EXPIRE', KEYS[3], ttl)
end
return {1, 'OK', 0}
