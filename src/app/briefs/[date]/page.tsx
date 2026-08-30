export const dynamic = 'force-dynamic';
export const revalidate = 0;

import BriefDetail from '../../../components/briefs/BriefDetail';

export default async function BriefDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <BriefDetail date={date} />;
}
