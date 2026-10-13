/**
 * Re-exported from `@emeradar/services` so there is one sender in the codebase.
 * This module used to hold a second copy of the Resend call, which meant "did that
 * email go out?" had two implementations and two different answers.
 */
export { sendTransactionalEmail } from '@emeradar/services';
