import browser from 'webextension-polyfill';
import type { Runtime } from 'webextension-polyfill';
import { authorizeMutation } from './storage';
import { AUTHORIZE_MUTATION, validateWriteRequest } from './write-protocol';

/** The event page authorizes a persisted WAL attempt; it never executes clicks. */
export async function authorizeContentMutation(
  message: unknown,
  sender: Runtime.MessageSender,
) {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== AUTHORIZE_MUTATION
  )
    return undefined;
  try {
    if (
      sender.id !== browser.runtime.id ||
      sender.tab?.id === undefined ||
      !sender.url
    )
      throw new Error(
        'Mutationserlaubnis nur für das eigene YouTube-Content-Script.',
      );
    if (!('request' in message)) throw new Error('Keine konkrete Mutation.');
    const request = validateWriteRequest(message.request);
    const url = new URL(sender.url);
    if (
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/watch' ||
      url.searchParams.getAll('v').length !== 1 ||
      url.searchParams.get('v') !== request.videoId ||
      !['add', 'remove'].includes(request.method)
    )
      throw new Error(
        'Sender-Tab stimmt nicht mit der angefragten Mutation überein.',
      );
    // This atomically consumes exactly one durable running step/attempt. An
    // ordinary approval object or repeated message is not sufficient authority.
    await authorizeMutation(request);
    return { authorized: true };
  } catch (error) {
    return {
      authorized: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
