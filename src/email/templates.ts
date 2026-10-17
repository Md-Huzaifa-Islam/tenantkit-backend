const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>
       <p style="color:#6b7280;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(cta.url)}</span></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f5f6fa;padding:32px">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:32px;color:#111827">
    <p style="font-weight:700;color:#4f46e5;margin:0 0 16px">TenantKit</p>
    <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    ${body}${button}
  </div></body></html>`;
}

export const emails = {
  verify: (name: string, url: string) => ({
    subject: 'Verify your email address',
    html: layout(`Welcome, ${name}!`, '<p>Confirm your email address to finish setting up your account.</p>', {
      label: 'Verify email',
      url,
    }),
  }),
  resetPassword: (url: string) => ({
    subject: 'Reset your password',
    html: layout(
      'Reset your password',
      '<p>We received a request to reset your password. This link expires in 1 hour and can be used once. If you did not ask for this, ignore this email.</p>',
      { label: 'Choose a new password', url },
    ),
  }),
  invite: (inviter: string, workspace: string, role: string, url: string) => ({
    subject: `${inviter} invited you to ${workspace} on TenantKit`,
    html: layout(
      `Join ${workspace}`,
      `<p><strong>${esc(inviter)}</strong> invited you to join <strong>${esc(workspace)}</strong> as ${esc(role.toLowerCase())}. The invitation expires in 7 days.</p>`,
      { label: 'Accept invitation', url },
    ),
  }),
  paymentFailed: (workspace: string, url: string) => ({
    subject: `Payment failed for ${workspace}`,
    html: layout(
      'We could not process your payment',
      `<p>The latest payment for <strong>${esc(workspace)}</strong> failed. Update your payment method to keep your plan.</p>`,
      { label: 'Manage billing', url },
    ),
  }),
};
