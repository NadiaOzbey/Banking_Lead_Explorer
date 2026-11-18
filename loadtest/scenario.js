import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const origin = __ENV.APP_ORIGIN || 'https://localhost:8443';
const { accounts, profileId, query } = JSON.parse(open(__ENV.K6_ACCOUNTS || '../.env.loadtest.json'));
if (accounts.length < 50) throw new Error('Seed at least 50 distinct client accounts');

export const options = {
  vus: 50,
  noCookiesReset: true,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const loginDuration = new Trend('login_duration', true);
const headers = { Origin: origin, 'X-Lead-CSRF': '1', 'Content-Type': 'application/json' };

export default function () {
  if (exec.vu.iterationInScenario === 0) sleep((exec.vu.idInTest % 20) / 10);
  const jar = http.cookieJar();
  const iteration = exec.vu.iterationInScenario;
  if (iteration % 5 === 0 || !jar.cookiesForURL(origin)['__Host-lead_explorer']) {
    const response = http.post(origin + '/api/auth/login', JSON.stringify(accounts[exec.vu.idInTest - 1]),
      { headers, tags: { name: 'login' } });
    loginDuration.add(response.timings.duration);
    if (!check(response, { 'login succeeds': (res) => res.status === 200 })) {
      sleep(1);
      return;
    }
  }
  const list = http.get(origin + '/api/profiles', { tags: { name: 'list' } });
  check(list, { 'list includes assigned profile': (res) => res.status === 200 && res.json('items.0.id') === profileId });
  const search = http.get(origin + '/api/profiles?q=' + encodeURIComponent(query), { tags: { name: 'search' } });
  check(search, { 'search returns one profile': (res) => res.status === 200 && res.json('total') === 1 });
  const detail = http.get(origin + '/api/profiles/' + encodeURIComponent(profileId), { tags: { name: 'detail' } });
  check(detail, { 'detail matches assigned ID': (res) => res.status === 200 && res.json('id') === profileId });
  sleep(0.75 + Math.random() * 0.5);
}
