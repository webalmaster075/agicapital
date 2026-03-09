// Vercel Serverless Function — POST /api/submit
// Saves lead to Notion + sends email via Gmail SMTP (via nodemailer)
// Env vars needed in Vercel dashboard:
//   NOTION_TOKEN        — your Notion integration token
//   NOTION_DB_ID        — Content Pipeline DB id (or separate Leads DB)
//   GMAIL_USER          — alexweb075@gmail.com
//   GMAIL_PASS          — Gmail App Password (16-char)

const https = require('https');

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const token = process.env.NOTION_TOKEN;
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendEmail(lead) {
  // Using Gmail SMTP via nodemailer (installed as dep)
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
    await transporter.sendMail({
      from: `"AGI Capital Lead" <${process.env.GMAIL_USER}>`,
      to: 'alexweb075@gmail.com',
      subject: `🔔 Новая заявка с сайта: ${lead.name} — ${lead.service}`,
      html: `
        <h2>Новая заявка с AGI Capital</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;font-weight:bold">Имя</td><td style="padding:8px">${lead.name}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Компания</td><td style="padding:8px">${lead.company || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Email</td><td style="padding:8px">${lead.email}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Телефон</td><td style="padding:8px">${lead.phone || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Услуга</td><td style="padding:8px">${lead.service}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Сообщение</td><td style="padding:8px">${lead.message || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold">Время</td><td style="padding:8px">${lead.timestamp}</td></tr>
        </table>
      `,
    });
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const lead = req.body;
  if (!lead || !lead.name || !lead.email) {
    return res.status(400).json({ error: 'Missing required fields: name, email' });
  }
  lead.timestamp = new Date().toISOString();

  const errors = [];

  // 1. Save to Notion
  try {
    const dbId = process.env.NOTION_DB_ID || '31e2800a-52ca-81f0-9252-d08709161927';
    const notionRes = await notionRequest('POST', '/v1/pages', {
      parent: { database_id: dbId },
      properties: {
        Title: { title: [{ text: { content: `${lead.name} — ${lead.service || 'General'}` } }] },
        Channel: { select: { name: '📸 Instagram' } }, // reuse existing field as source
        Status: { select: { name: '💡 Idea' } },
        Notes: { rich_text: [{ text: { content: `Email: ${lead.email}\nPhone: ${lead.phone || '—'}\nCompany: ${lead.company || '—'}\nService: ${lead.service || '—'}\nMessage: ${lead.message || '—'}\nTime: ${lead.timestamp}` } }] },
      },
    });
    if (notionRes.object === 'error') {
      errors.push('Notion: ' + notionRes.message);
    }
  } catch (err) {
    errors.push('Notion error: ' + err.message);
  }

  // 2. Send email
  const emailOk = await sendEmail(lead);
  if (!emailOk) errors.push('Email send failed');

  if (errors.length > 0) {
    console.error('Submission errors:', errors);
    // Still return 200 — lead might be saved partially
    return res.status(200).json({ success: true, warnings: errors });
  }

  return res.status(200).json({ success: true });
};
