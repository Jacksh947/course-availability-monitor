import test from 'node:test';
import assert from 'node:assert/strict';
import { playwright, readPage, restoreSession, captureSession, navigateAndRead } from '../src/browser.mjs';

const target = { course: 'TEST 100', term: '2027 Winter', class_number: '1234' };
const headings = '<tr><th>Class Capacity</th><th>Enrolment Total</th><th>Available Seats</th><th>Waitlist Capacity</th><th>Waitlist Total</th></tr>';
const table = `<table>${headings}<tr><td>55</td><td>55</td><td>0</td><td>5</td><td>5</td></tr></table>`;
const info = (number = '1234') => `<section><h2>TEST 100 Sales Management</h2><p>Lecture - ${number}</p><p>Status : Closed</p>${table}</section>`;

test('browser extraction binds counts to the correct class and term', async () => {
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://portal.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>2027 Winter</p>' + info() }));
    await page.goto('https://portal.example/course');
    const result = await readPage(context, target);
    assert.equal(result.class_number, '1234'); assert.equal(result.waitlist_total, '5');

    const splitTables = `<section><h2>TEST 100 Sales Management</h2><p>Status : Closed</p><p>Lecture - 1234</p><div><div><table>${headings.replace('Enrolment', 'Enrollment')}<th></th></table></div><div><table><tr><th></th><th></th><th></th><th></th><th></th></tr><tr><td>55</td><td>55</td><td>0</td><td>5</td><td>5</td></tr></table></div></div></section>`;
    await page.setContent('<p>2027 Winter</p>' + splitTables);
    assert.equal((await readPage(context, target)).enrolment_total, '55');

    await page.setContent('<p>2027 Winter</p><p>TEST 100 Lecture - 1234</p>' + info('9999'));
    await assert.rejects(() => readPage(context, target), /availability_not_verified/);

    await page.setContent('<p>2027 Winter</p>' + info('12340'));
    await assert.rejects(() => readPage(context, target), /availability_not_verified/);

    await page.setContent('<p>2026 Fall</p>' + info());
    await assert.rejects(() => readPage(context, target), /term_not_verified/);

    await page.setContent('<p>2027 Winter</p>' + info().replace('<td>0</td>', '<td>?</td>'));
    await assert.rejects(() => readPage(context, target), /availability_not_verified/);

    await page.setContent('<p>Sign in</p><input type="password">');
    await assert.rejects(() => readPage(context, target));
    await context.close();
  } finally { await browser.close(); }
});

test('session capture and restore preserves cookies and session storage privately', async () => {
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const first = await browser.newContext();
    const page = await first.newPage();
    await page.route('https://portal.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Local fixture</p>' }));
    await page.goto('https://portal.example/course');
    await first.addCookies([{ name: 'fixture', value: 'placeholder', domain: 'portal.example', path: '/' }]);
    await page.evaluate(() => sessionStorage.setItem('fixture-key', 'placeholder'));
    const session = await captureSession(first);
    const second = await restoreSession(browser, session);
    const restoredPage = await second.newPage();
    await restoredPage.route('https://portal.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Local fixture</p>' }));
    await restoredPage.goto('https://portal.example/course');
    assert.equal(await restoredPage.evaluate(() => sessionStorage.getItem('fixture-key')), 'placeholder');
    assert.equal((await second.cookies()).find(cookie => cookie.name === 'fixture').value, 'placeholder');
    await first.close(); await second.close();
  } finally { await browser.close(); }
});

test('fresh browser navigates a recent course and opens its availability tab', async () => {
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://portal.example/**', route => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/entry' ? '<p>2027 Winter</p><a href="/course">TEST 100</a>' :
        path === '/course' ? '<p>2027 Winter</p><a href="/details">Lecture - 1234</a>' :
        `<p>2027 Winter</p><button onclick="document.querySelector('section').hidden=false">Class Availability</button><section hidden>${info()}</section>`;
      return route.fulfill({ contentType: 'text/html', body });
    });
    const result = await navigateAndRead(context, { ...target, entry_url: 'https://portal.example/entry', navigation_timeout_ms: 8000 });
    assert.equal(result.class_number, '1234'); assert.equal(result.waitlist_total, '5');
    await context.close();
  } finally { await browser.close(); }
});

test('course search fallback uses only the course-search field', async () => {
  const browser = await playwright().chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    let searched = false;
    await context.route('https://portal.example/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/results') searched = true;
      const body = path === '/entry' ? '<p>2027 Winter</p><input placeholder="Enter keyword e.g. course, subject, class, topic" onkeydown="if(event.key===\'Enter\')location.href=\'/results\'">' :
        path === '/results' ? '<p>2027 Winter</p><a href="/course">TEST 100</a>' :
        path === '/course' ? '<p>2027 Winter</p><a href="/details">Lecture - 1234</a>' :
        `<p>2027 Winter</p>${info()}`;
      return route.fulfill({ contentType: 'text/html', body });
    });
    assert.equal((await navigateAndRead(context, { ...target, entry_url: 'https://portal.example/entry', navigation_timeout_ms: 8000 })).class_number, '1234');
    assert(searched);
    await context.close();
  } finally { await browser.close(); }
});
