import type { TFunction } from 'i18next';
import type { AppError } from '../state/store.ts';

/** The friendly message for an app error. */
export function errorMessage(t: TFunction, err: AppError): string {
  switch (err.code) {
    case 'heic':
      return t('errors.heic');
    case 'decode':
      return t('errors.decode');
    case 'too-small':
      return t('errors.tooSmall');
    case 'share-invalid':
      return t('errors.shareInvalid');
    case 'example-fetch':
      return t('errors.exampleFetch');
    case 'no-image':
    case 'internal':
    default:
      return t('errors.internal');
  }
}
