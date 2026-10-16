// Fetches /api/config from server.py once per page and shares the result.
// Shape: { live, reason?, accountId, merchants, contacts, home, openingBalance, auth0?: { domain, clientId } }

let configPromise = null;

function loadConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/config', { cache: 'no-store' })
      .then((res) => res.json())
      .catch(() => ({ live: false, reason: 'Start the site with "python server.py" to use Nessie' }));
  }
  return configPromise;
}
