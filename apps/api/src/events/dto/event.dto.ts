/**
 * Request shape for `PUT /api/events/:eventId`.
 *
 * `title` maps to the `event_name` column, and `event_date` is a full
 * timestamp that gets split across the `event_date` and `event_time` columns —
 * there is no separate time field on the wire.
 */
export interface UpdateEventDto {
  title?: string;
  description?: string;
  /** ISO timestamp; supplies both the date and the time. */
  event_date?: string;
  location?: string;
}
