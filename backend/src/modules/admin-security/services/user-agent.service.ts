import { Injectable } from '@nestjs/common';
import { UAParser } from 'ua-parser-js';
import { DeviceType } from '../../../database/entities';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  device_type: DeviceType;
}

/**
 * Wraps ua-parser-js for predictable typed output. Returns DeviceType
 * (DESKTOP / MOBILE / TABLET / UNKNOWN) by inspecting parser.device.type:
 *   - mobile / wearable → MOBILE
 *   - tablet → TABLET
 *   - undefined → DESKTOP (parser convention: empty `type` means desktop)
 *   - everything else → UNKNOWN
 */
@Injectable()
export class UserAgentService {
  parse(rawUa: string | null | undefined): ParsedUserAgent {
    if (!rawUa) {
      return { browser: null, os: null, device_type: DeviceType.UNKNOWN };
    }

    const parser = new UAParser(rawUa);
    const browser = parser.getBrowser();
    const os = parser.getOS();
    const device = parser.getDevice();

    let device_type: DeviceType;
    switch (device.type) {
      case 'mobile':
      case 'wearable':
        device_type = DeviceType.MOBILE;
        break;
      case 'tablet':
        device_type = DeviceType.TABLET;
        break;
      case undefined:
        device_type = DeviceType.DESKTOP;
        break;
      default:
        device_type = DeviceType.UNKNOWN;
    }

    return {
      browser: browser.name
        ? `${browser.name}${browser.version ? ' ' + browser.version : ''}`
        : null,
      os: os.name ? `${os.name}${os.version ? ' ' + os.version : ''}` : null,
      device_type,
    };
  }
}
