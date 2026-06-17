import { Inject, Injectable } from '@nestjs/common';
import {
  ERP_CONNECTORS,
  ErpCapabilities,
  IErpConnector,
  IErpConnectorRegistry,
} from './erp-connector.interface';

/**
 * Phase 7.28 — ERP connector registry.
 *
 * Builds a vendor→adapter map from the injected array of registered adapters
 * (collected by the module's `ERP_CONNECTORS` factory). The core engine resolves
 * the active adapter PER-ORG at job time via `resolve(connection.vendor)` — it
 * never imports a concrete adapter or branches on a vendor name.
 *
 * Adding a new ERP = (1) write the adapter file, (2) add it to the
 * `ERP_CONNECTORS` factory in integrations.module.ts. The registry, engine,
 * queue, neutral model, and dashboard are untouched.
 *
 * `vendor` is stored as a plain string (not a DB enum) precisely so adding an
 * adapter needs no schema migration — DTO validation defers to
 * `knownVendors()`, which is registry-driven.
 */
@Injectable()
export class ErpConnectorRegistry implements IErpConnectorRegistry {
  private readonly byVendor = new Map<string, IErpConnector>();

  constructor(
    @Inject(ERP_CONNECTORS) connectors: IErpConnector[],
  ) {
    for (const connector of connectors) {
      const vendor = connector.capabilities.vendor;
      if (this.byVendor.has(vendor)) {
        throw new Error(
          `ErpConnectorRegistry: duplicate adapter registered for vendor '${vendor}'`,
        );
      }
      this.byVendor.set(vendor, connector);
    }
  }

  resolve(vendor: string): IErpConnector {
    const connector = this.byVendor.get(vendor);
    if (!connector) {
      throw new Error(
        `No ERP connector registered for vendor '${vendor}'. ` +
          `Known vendors: ${this.knownVendors().join(', ') || '(none)'}.`,
      );
    }
    return connector;
  }

  has(vendor: string): boolean {
    return this.byVendor.has(vendor);
  }

  knownVendors(): string[] {
    return [...this.byVendor.keys()];
  }

  allCapabilities(): ErpCapabilities[] {
    return [...this.byVendor.values()].map((c) => c.capabilities);
  }

  capabilitiesFor(vendor: string): ErpCapabilities {
    return this.resolve(vendor).capabilities;
  }
}
