import { serve } from '../shared/serveWithCors.ts';
import { getSupabaseClient } from '../shared/supabaseClient.ts';
import { Logger } from '../shared/logger.ts';
import { Monitor } from '../shared/monitor.ts';

const logger = new Logger('domain-update-worker');
const monitor = new Monitor('domain-update-batcher');
const DB_URL = Deno.env.get('DB_URL') ?? '';
const DOMAIN_UPDATER_URL = Deno.env.get('WORKER_DOMAIN_UPDATER_URL') ?? `${DB_URL}/functions/v1/domain-updater`;

serve(async (req) => {
  await monitor.start(req);
  const supabase = getSupabaseClient(req);
  const now = new Date();
  const jobsToFetch = 20;
  const retryCutoff = new Date(Date.now() - 60 * 1000);

  try {
    // Fetch 20 queued jobs
    const { data: jobs, error } = await supabase
      .from('domain_update_jobs')
      .select('*')
      .eq('status', 'queued')
      .or('last_attempt_at.is.null,last_attempt_at.lt.' + retryCutoff.toISOString())
      .order('last_attempt_at', { ascending: true })
      .limit(jobsToFetch);

    if (error) {
      logger.error(`Failed to fetch jobs: ${error.message}`);
    }

    if (error || !jobs?.length) {
      await monitor.success('No jobs to process');
      return new Response('No jobs to process', { status: 200 });
    }

    let successCount = 0;
    let failCount = 0;

    for (const job of jobs) {
      const domain = job.domain;
      const userId = job.user_id;

      // Mark as in progress
      const { error: markErr } = await supabase
        .from('domain_update_jobs')
        .update({
          status: 'in_progress',
          last_attempt_at: now.toISOString(),
          attempts: job.attempts + 1,
        })
        .eq('domain', domain);

      if (markErr) {
        logger.error(`Failed to mark job in progress: ${domain}`);
        continue;
      }

      // Call domain-updater
      try {
        const res = await fetch(DOMAIN_UPDATER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers.get('Authorization') ?? '',
          },
          body: JSON.stringify({ domain, user_id: userId }),
        });

        if (res.ok) {
          await supabase
            .from('domain_update_jobs')
            .update({ status: 'complete', last_updated_at: new Date().toISOString() })
            .eq('domain', domain);
          successCount++;
        } else {
          throw new Error(await res.text());
        }
      } catch (err) {
        await supabase
          .from('domain_update_jobs')
          .update({ status: 'failed' })
          .eq('domain', domain);
        failCount++;
        logger.warn(`Job failed: ${domain} - ${(err as Error).message}`);
      }
    }

    const summary = `✅ ${successCount} succeeded, ❌ ${failCount} failed`;
    await monitor.success(summary);
    return new Response(summary, { status: 200 });

  } catch (err: any) {
    await monitor.fail(err);
    logger.error('Unexpected error:' + err.message);
    return new Response('Internal Server Error', { status: 500 });
  }
});
