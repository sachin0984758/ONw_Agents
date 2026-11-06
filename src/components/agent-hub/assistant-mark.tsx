import Image from 'next/image'

export function AssistantMark({ className = 'size-4' }: { className?: string }) {
  return <Image src="/logo.svg" width={30} height={30} alt="" aria-hidden="true" className={className} />
}
