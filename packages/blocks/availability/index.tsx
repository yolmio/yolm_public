import { AvailabilityPage } from "./availability_page";
import { AvailabilityBlock } from "./availability_block";

(AvailabilityBlock as any).AvailabilityPage = AvailabilityPage;

export { AvailabilityBlock, AvailabilityPage };
