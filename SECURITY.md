# Security Policy

## Supported versions

Only the latest release of `rdap-q` on npm receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include the version, the command you ran, and what happened. You will get a reply as soon as a maintainer can look at it.

## Scope

RDAP-Q is a local CLI, installer, and agent skill with no package dependencies. Reports we care about most:

- `rdapq install` or `rdapq init` writing, replacing, or deleting files outside the paths they document.
- The engine running a command the task plan did not record, or reading or writing outside the repository and `$RDAPQ_HOME`.
- Memory or task files storing something that looks like a secret.
- Anything in the published npm package that should not be there.

## Releases

CI holds no npm token and cannot publish. A maintainer stages each release and publishes it by hand with npm two-factor authentication.
