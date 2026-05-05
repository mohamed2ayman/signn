import { Injectable } from '@nestjs/common';
import ical from 'ical-generator';
import { Obligation } from '../../../database/entities';

/**
 * Builds a `.ics` file with one VEVENT per obligation that has a fixed
 * due_date. Used to expose obligation deadlines into Outlook / Google
 * Calendar.
 */
@Injectable()
export class IcalExportService {
  build(input: {
    name: string;
    obligations: Obligation[];
  }): string {
    const cal = ical({
      name: input.name,
      prodId: { company: 'SIGN', product: 'Compliance', language: 'EN' },
    });
    for (const o of input.obligations) {
      if (!o.due_date) continue;
      const start = new Date(o.due_date);
      // All-day event ending the same day
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      cal.createEvent({
        start,
        end,
        allDay: true,
        summary: `[${o.is_critical ? 'CRITICAL' : o.obligation_type}] ${o.description}`.slice(0, 200),
        description: [
          o.timeframe_description ?? '',
          o.clause_ref ? `Clause: ${o.clause_ref}` : '',
          o.responsible_party ? `Party: ${o.responsible_party}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        id: o.id,
      });
    }
    return cal.toString();
  }
}
