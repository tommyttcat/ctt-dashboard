import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(request: Request) {
  // 1. Security: Ensure only Vercel Cron can trigger this route in production
  const authHeader = request.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    // 2. Determine the time of day for the greeting
    const estDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = estDate.getHours();
    let sessionName = "Post-Market";
    if (hour < 10) sessionName = "Pre-Market";
    else if (hour < 16) sessionName = "Mid-Day";

    // 3. Construct the HTML Email (Using inline CSS for email clients)
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; background-color: #0b101a; color: #f1f5f9; padding: 40px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c8bfa; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px;">
          CTT Dashboard
        </h2>
        <h1 style="font-size: 24px; margin-top: 0; margin-bottom: 24px;">
          ${sessionName} Market Update
        </h1>
        
        <p style="color: #94a3b8; font-size: 16px; line-height: 1.5; margin-bottom: 32px;">
          The market is moving. Tap below to launch your live workspace, review active momentum setups, and check the latest institutional flow.
        </p>

        <a href="https://ctt-dashboard.vercel.app" 
           style="display: inline-block; background-color: #6366f1; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; text-align: center;">
          Launch Live Dashboard
        </a>

        <hr style="border-color: #1e293b; border-style: solid; margin-top: 40px; margin-bottom: 20px;" />
        
        <p style="color: #475569; font-size: 12px; text-align: center;">
          Confluence Trading Tools • Automated Alert System
        </p>
      </div>
    `;

    // 4. Send the Email via Resend
    const data = await resend.emails.send({
      from: 'CTT System <onboarding@resend.dev>', // Resend's default testing address
      to: ['your-actual-email@gmail.com'], // <--- CHANGE THIS TO YOUR EMAIL
      subject: `CTT: ${sessionName} Market Snapshot`,
      html: htmlContent,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error }, { status: 500 });
  }
}