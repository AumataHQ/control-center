# The newsroom on TrueNAS

Control Center runs on the NAS alongside the backups it reads. This is how it
gets there, what protects it, and what to check when it stops working.

## What runs where

| Piece | Host | Address |
| --- | --- | --- |
| The publication pipeline | Vultr, under Coolify | app `r1eakmoq7go9pwqnhst3uao2` |
| The public edition | Cloudflare Pages | `signalscribe.ai` |
| Object storage (backups + the trail) | TrueNAS | `100.121.13.81:9000`, console `:9001` |
| The mirror | TrueNAS | no port; writes `/mnt/Pool/newsroom/pipeline` |
| Control Center | TrueNAS | `http://100.121.13.81:3010` |

The stack lives in `/mnt/Pool/apps/stacks/newsroom` and its durable state in
`/mnt/Pool/newsroom`.

## What protects it

Control Center has no login. Two controls stand in for one, and they do
different jobs — confusing them is how this becomes an open dashboard.

**The published port is the access boundary.** `compose.yaml` publishes every
service on `${BIND_ADDRESS}` — the host's Tailscale address — and nothing else.
Only traffic that can reach that address reaches the app at all. `ss -ltn` on
the host should show `100.121.13.81:3010`, never `0.0.0.0:3010`.

**The host allowlist defends against DNS rebinding.** `CONTROL_CENTER_ALLOWED_HOSTS`
names the hostnames the API answers on. A page you visit can point a hostname of
its own at the app's address, but the browser then sends *that* hostname in
`Host`, and the request is refused. It is not a defence against a direct request
from something already on the network, which can set any `Host` header it likes.

Everyone on the tailnet can read the whole dashboard. That is the accepted
trade for it living here.

## Deploying a change

```bash
cd ~/Documents/GitHub/control-center
npm run check
./deploy/truenas/build-image.sh    # builds on the NAS from committed source
./deploy/truenas/deploy.sh         # pushes compose.yaml and brings the stack up
```

`build-image.sh` streams `git archive HEAD` over SSH, so the image contains
exactly what is committed and is built for the host's architecture. It refuses
to run when tracked files have uncommitted edits.

Secrets live only in `/mnt/Pool/apps/stacks/newsroom/.env` on the host, written
once by hand from `deploy/truenas/.env.example`. `deploy.sh` never sends one and
refuses to run if that file is missing.

## How the trail gets here

The pipeline pushes; nothing reaches into it.

1. `newsroom_sync.py` runs from `run_daily_brief.sh`'s exit trap — on every run,
   published or not — and uploads the day's artifacts to `s3://signalscribe-backups/newsroom/`.
2. `newsroom-mirror` pulls that prefix down to `/mnt/Pool/newsroom/pipeline`
   every five minutes. `mc mirror` without `--remove`: the newsroom is an
   archive of what the pipeline did, not a replica of its working directory.
3. Control Center reads `/newsroom` (that directory, mounted read-only).

The dashboard's pipeline root is a setting, not an environment variable. It is
`/newsroom`, set once through Settings.

## When something is wrong

**The dashboard shows no editions.** Check the mirror first:

```bash
ssh truenas 'sudo docker logs newsroom-mirror --tail 20'
```

`Object does not exist` means the pipeline has not synced yet — expected before
the first run of a new deployment. Anything else is a credentials or network
problem between the mirror and MinIO.

**The pipeline stopped syncing.** Run it by hand and read the output:

```bash
ssh vultr-buzz 'docker exec $(docker ps --format "{{.Names}}" | grep r1eak) sh -lc "doppler run --preserve-env=SS_SOURCE_COMMIT -- python3 scripts/newsroom_sync.py"'
```

**A backup needs restoring.** Backups are `.tar.gz` under the `signalscribe/`
prefix, one per run, verified after upload. To check one without restoring it:

```bash
ssh truenas 'sudo docker exec newsroom-minio mc ls --recursive local/signalscribe-backups'
```

Extract it, then open `data/kb/signalscribe.db` read-only and run
`PRAGMA integrity_check` before trusting it.

## The single point of failure

TrueNAS now holds the newsroom, the only backup, and the model gateway. Losing
that box loses all three at once. That is a deliberate choice, not an oversight:
R2 was disconnected when the backup moved here. If the trade stops looking
worthwhile, `SS_BACKUP_S3_*` in Doppler is the whole of the configuration and
pointing it at a second target is a five-minute change.
