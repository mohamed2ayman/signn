/**
 * Email transport abstraction.
 *
 * EMAIL_PROVIDER is the DI injection token. Inject EmailService in application
 * code — this token is only used inside NotificationsModule's factory wiring.
 */

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface IEmailProvider {
  /**
   * Deliver one email message.
   * @param params.from   Sender address (e.g. "noreply@sign.ai")
   * @param params.to     Recipient address
   * @param params.subject Email subject line
   * @param params.html   Fully-rendered HTML body
   */
  send(params: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void>;
}
