# CORS change needed in the ClassYear (Express/Lambda) repo

**One-line summary:** the shared photo bucket must allow
`https://nest.reunion-connect.org` as an origin, or presigned **uploads** from
the new app fail their preflight.

This is a change to the *other* repo — `~/Code/ClassYear`, stack
`classyear-serverless` — because that stack owns the bucket. It is written up
here rather than applied because applying it from this side means either editing
a resource CloudFormation manages (drift, silently reverted by the old stack's
next deploy) or deploying the old stack, which is out of scope for this work.

## Why the bucket is what needs changing

No file bytes pass through either API. An upload is a presigned `PUT` the
**browser** performs straight against S3 (docs §17), so the preflight goes to
the bucket and the bucket's CORS rules are what answer it. Nothing in this repo
can grant that, and the API's own CORS settings are irrelevant to it.

Note the asymmetry, because it makes the bug easy to misread once §27's fix is
deployed:

| Operation | Needs bucket CORS? |
|---|---|
| **Displaying** a photo (`GET` via presigned URL, `<img src>`) | No — plain image load, not a CORS request |
| **Uploading** a photo (presigned `PUT` from `fetch`/`XHR`) | **Yes** |

So after §27, photos will *display* correctly on `nest.reunion-connect.org`
while uploads keep failing until this change ships. Different symptom, different
cause — do not read a working image as evidence that this is done.

## The change

`template.yaml`, resource `ReunionConnectPrivateFileBucket` (~line 126). The
rule today lists three origins:

```yaml
      CorsConfiguration:
        CorsRules:
          - AllowedOrigins:
              - !Ref FrontendURL
              - https://unicornconnections.org
              - https://www.unicornconnections.org
```

Add the new app's origin:

```yaml
      CorsConfiguration:
        CorsRules:
          - AllowedOrigins:
              - !Ref FrontendURL
              - https://unicornconnections.org
              - https://www.unicornconnections.org
              # The NestJS app shares this bucket (ClassYearNest docs §27) and
              # its uploads are presigned PUTs from the browser, so the origin
              # it is served from has to be listed here.
              - https://nest.reunion-connect.org
```

Deploying the old stack applies it; the bucket is not replaced, since
`CorsConfiguration` is an in-place update.

### A smaller alternative, if deploying that stack is unwelcome

```
aws s3api put-bucket-cors --bucket classyear-file-storage-372666940943-dev \
  --cors-configuration file://cors.json
```

This works immediately but **drifts** from `classyear-serverless` — the old
stack's next deploy silently reverts it and uploads break again with no change
on this side to explain it. If it is used as a stopgap, the template change
still has to follow.

## Live CORS rules, for reference

Captured 2026-09-05 from the deployed bucket:

```json
{"CORSRules": [{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedOrigins": [
    "https://reunion-connect.org",
    "https://unicornconnections.org",
    "https://www.unicornconnections.org"
  ],
  "MaxAgeSeconds": 3600
}]}
```

`FrontendURL` resolves to `https://reunion-connect.org`.

**Unrelated gap, noticed while reading this:** `https://www.reunion-connect.org`
is *not* in the list, though the other three public names are and it serves the
old app today. If uploads have ever failed for someone on the `www` variant of
that domain, this is why. Not verified against a real report, and not part of
the §27 fix — worth a look on its own.

## Phase 8

When the apex moves to the new app, this list needs revisiting again: the origin
that matters becomes `https://unicornconnections.org` and
`https://reunion-connect.org` pointing at the *new* distribution. Those entries
already exist, so phase 8 needs no CORS change — but `nest.reunion-connect.org`
becomes dead weight in the list and can come out once the subdomain is retired.
