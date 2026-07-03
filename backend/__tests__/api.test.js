const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDbPath = path.join(os.tmpdir(), `aman-pharma-test-${Date.now()}.db`);
process.env.DB_PATH = testDbPath;

const app = require('../server');

afterAll(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
});

describe('Health Check', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth - Sign In', () => {
  it('POST /api/auth/signin without fields returns 400', async () => {
    const res = await request(app).post('/api/auth/signin');
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/signin with valid data returns 201 with pending status', async () => {
    const res = await request(app)
      .post('/api/auth/signin')
      .field('email', 'test@amanpharma.com')
      .field('phone', '+251911309608')
      .attach('efda_license', Buffer.from('fake-image-data'), 'license.jpg');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('test@amanpharma.com');
    expect(res.body.user.status).toBe('pending');
  });

  it('POST /api/auth/signin with duplicate email returns 409', async () => {
    const res = await request(app)
      .post('/api/auth/signin')
      .field('email', 'test@amanpharma.com')
      .field('phone', '+251911309608')
      .attach('efda_license', Buffer.from('fake-image-data'), 'license.jpg');
    expect(res.status).toBe(409);
  });

  it('POST /api/auth/signin with PDF file returns 201', async () => {
    const res = await request(app)
      .post('/api/auth/signin')
      .field('email', 'pdfuser@amanpharma.com')
      .field('phone', '+251911309609')
      .attach('efda_license', Buffer.from('fake-pdf-content'), 'license.pdf');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user.status).toBe('pending');
  });
});

describe('Auth - Login with pending', () => {
  it('POST /api/auth/login with pending user returns 403', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@amanpharma.com' });
    expect(res.status).toBe(403);
    expect(res.body.status).toBe('pending');
  });

  it('POST /api/auth/login with unknown email returns 404', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown@test.com' });
    expect(res.status).toBe(404);
  });
});

describe('Auth - Admin user management', () => {
  it('GET /api/auth/users returns user list', async () => {
    const res = await request(app).get('/api/auth/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('POST /api/auth/users/:id/approve approves a pending user', async () => {
    const listRes = await request(app).get('/api/auth/users');
    const pendingUser = listRes.body.users.find(u => u.status === 'pending');
    expect(pendingUser).toBeDefined();
    const res = await request(app)
      .post(`/api/auth/users/${pendingUser.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/auth/login with approved user returns 200', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@amanpharma.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.status).toBe('approved');
  });
});

describe('Products', () => {
  it('GET /api/products returns array', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Contact', () => {
  it('POST /api/contact with invalid data returns 400', async () => {
    const res = await request(app).post('/api/contact').send({ name: '', email: 'bad', message: '' });
    expect(res.status).toBe(400);
  });
});
