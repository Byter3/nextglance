/** Windows/Node entry point. Protocol behavior is shared with the Android client. */
import {createHash, randomUUID} from 'node:crypto';
import {NextcloudClient as PortableNextcloudClient} from '@nextspace/nextcloud-client';
export {beginLogin, pollLogin, normalizeServerUrl, calendarInterval} from '@nextspace/nextcloud-client';

const nodeRuntime = Object.freeze({
  sha256: value => createHash('sha256').update(value).digest('hex'),
  randomUUID,
});

export class NextcloudClient extends PortableNextcloudClient {
  constructor(credentials, options = {}) {
    super(credentials, {runtime: nodeRuntime, ...options});
  }
}
