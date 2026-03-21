/**
 * Base email layout wrapper — Sign brand styling
 * All email templates use this as their outer shell.
 */

const BRAND_COLOR = '#4F6EF7';
const BRAND_DARK = '#0F1729';
const BRAND_BG = '#F8FAFF';

export function baseEmailLayout(content: string, options?: { preheader?: string }): string {
  return `
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Sign Platform</title>
  <!--[if mso]>
  <style>table,td{font-family:Arial,sans-serif!important}</style>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; background-color: ${BRAND_BG}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { color: ${BRAND_COLOR}; text-decoration: none; }
    .btn { display: inline-block; padding: 14px 32px; background-color: ${BRAND_COLOR}; color: #ffffff !important; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px; }
    .btn:hover { background-color: #3B5CE4; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; padding: 12px !important; }
      .content-cell { padding: 24px 20px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:${BRAND_BG}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  ${options?.preheader ? `<div style="display:none;font-size:1px;color:${BRAND_BG};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${options.preheader}</div>` : ''}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_BG};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Logo -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;" class="email-container">
          <tr>
            <td style="padding-bottom: 24px; text-align: center;">
              <svg width="32" height="32" viewBox="-28 -28 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(0)" />
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(60)" />
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(120)" />
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(180)" />
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(240)" />
                <ellipse rx="16" ry="27" fill="${BRAND_COLOR}" opacity="0.80" transform="rotate(300)" />
                <path d="M0,-9 L2.5,0 L0,9 L-2.5,0Z" fill="white" />
                <path d="M-9,0 L0,-2.5 L9,0 L0,2.5Z" fill="white" />
                <circle cx="0" cy="0" r="4.5" fill="white" />
              </svg>
              <span style="display:inline-block; vertical-align:middle; margin-left:8px; font-size:22px; font-weight:700; color:${BRAND_DARK}; letter-spacing:-1.25px;">Sign</span>
            </td>
          </tr>

          <!-- Content card -->
          <tr>
            <td style="background-color:#ffffff; border-radius:16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="content-cell" style="padding: 40px 36px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 16px; text-align: center;">
              <p style="margin:0; font-size:12px; color:#9CA3AF; line-height:1.5;">
                &copy; ${new Date().getFullYear()} Sign Platform. All rights reserved.
              </p>
              <p style="margin:8px 0 0; font-size:11px; color:#D1D5DB;">
                Smart Contract Management &mdash; Powered by AI
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
