// Thin mail-sending interface. Local/dev points SMTP_HOST/SMTP_PORT at the
// Mailpit container (docker-compose); swapping to a real provider in
// production is a one-file env-var change, not a redesign.
import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 1025,
      secure: false,
    })
  }
  return transporter
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'no-reply@inventory.local',
    to,
    subject,
    html,
  })
}
