const https = require('https');

function notionRequest(body) {
  return new Promise((resolve, reject) => {
    const token = process.env.NOTION_TOKEN;
    const dbId = process.env.NOTION_DB_ID || '31e2800a-52ca-81f0-9252-d08709161927';
    const data = JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        Title: { title: [{ text: { content: `${body.name} — ${body.service || 'General'}` } }] },
        Channel: { select: { name: '📸 Instagram' } },
        Status: { select: { name: '💡 Idea' } },
        Notes: {
          rich_text: [{
            text: {
              content: [
                `Email: ${body.email}`,
                `Phone: ${body.phone || '—'}`,
                `Company: ${body.company || '—'}`,
                `Service: ${body.service || '—'}`,
                `Message: ${body.message || '—'}`,
                `Time: ${new Date().toISOString()}`
              ].join('\n')
            }
          }]
        }
      }
    });

    const options = {
      hostname: 'api.notion.com',
      path: '/v1/pages',
      method: 'POST',
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
        try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendEmail(lead) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });
    await transporter.sendMail({
      from: `"AGI Capital Leads" <${process.env.GMAIL_USER}>`,
      to: 'alexweb075@gmail.com',
      subject: `🔔 Новая заявка: ${lead.name} — ${lead.service || 'General'}`,
      html: `
        <h2 style="font-family:sans-serif">Новая заявка с AGI Capital</h2>
        <table style="font-family:sans-serif;border-collapse:collapse;width:100%;max-width:500px">
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Имя</td><td style="padding:8px;border:1px solid #eee">${lead.name}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Компания</td><td style="padding:8px;border:1px solid #eee">${lead.company || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #eee">${lead.email}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Телефон</td><td style="padding:8px;border:1px solid #eee">${lead.phone || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Услуга</td><td style="padding:8px;border:1px solid #eee">${lead.service || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Сообщение</td><td style="padding:8px;border:1px solid #eee">${lead.message || '—'}</td></tr>
          <tr><td style="padding:8px;border:1px solid #eee;font-weight:bold">Время</td><td style="padding:8px;border:1px solid #eee">${new Date().toISOString()}</td></tr>
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const lead = req.body;
  if (!lead || !lead.name || !lead.email) {
    return res.status(400).json({ error: 'Missing required fields: name, email' });
  }

  const warnings = [];

  // 1. Notion
  try {
    const result = await notionRequest(lead);
    if (result.object === 'error') {
      console.error('Notion error:', result.message);
      warnings.push('notion: ' + result.message);
    } else {
      console.log('Notion page created:', result.id);
    }
  } catch (err) {
    console.error('Notion exception:', err.message);
    warnings.push('notion_exception: ' + err.message);
  }

  // 2. Email
  if (process.env.GMAIL_PASS) {
    const ok = await sendEmail(lead);
    if (!ok) warnings.push('email_failed');
  } else {
    console.warn('GMAIL_PASS not set, skipping email');
    warnings.push('email_skipped: GMAIL_PASS not configured');
  }

  return res.status(200).json({ success: true, warnings });
};
