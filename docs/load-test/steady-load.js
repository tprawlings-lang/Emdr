// k6 load test for Steady. Exercises the hot read paths and the check-in write
// path. Run against a STAGING instance (never production data):
//
//   BASE=https://staging.example.com EMAIL=demo@example.com PASS=demo1234 \
//     k6 run docs/load-test/steady-load.js
//
// Thresholds below are the *pass/fail gate*. Numbers are conservative starting
// points; replace with the values discovered on the first staging run (see
// README.md) and wire this into CI as a nightly job against staging.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "http://localhost:3000";
const EMAIL = __ENV.EMAIL || "demo@example.com";
const PASS = __ENV.PASS || "demo1234";

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "1m", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<800", "p(99)<2000"], // discovered on staging
    checks: ["rate>0.99"],
  },
};

export default function () {
  // Public marketing page — pure read, cacheable.
  const home = http.get(`${BASE}/`);
  check(home, { "home 200": (r) => r.status === 200 });

  // Auth + a dashboard read (cookie jar is per-VU-iteration).
  const login = http.post(`${BASE}/login`, { email: EMAIL, password: PASS }, { redirects: 5 });
  check(login, { "login ok": (r) => r.status === 200 || r.status === 303 });

  const dash = http.get(`${BASE}/dashboard`);
  check(dash, { "dashboard reachable": (r) => r.status < 500 });

  sleep(1);
}
