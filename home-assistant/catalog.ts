/**
 * The `home-assistant` module, as the market offers it: slots on a Home Assistant board controller. A module from a
 * market has no catalog entry, so what it is made with comes from its own context; this one needs nothing of it.
 */
import { homeAssistant as client } from './client.ts'
import { homeAssistant as homeAssistantFactory } from './index.ts'

/** The module boardd loads: `home-assistant`, titled in `index.ts`, with this machine's client. */
export const homeAssistant = homeAssistantFactory({ client })
