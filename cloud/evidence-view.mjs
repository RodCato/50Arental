// Private bytes live only in memory while their view is mounted.
export class EvidenceView {
 constructor(get){this.get=get;this.epoch=0;this.urls=new Set();this.observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){this.observer.unobserve(e.target);e.target.loadPhoto?.();}});}
 clear(){this.epoch++;this.observer.disconnect();for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();}
 mount(slot,id,alt='Evidence photo'){
  const epoch=this.epoch,image=document.createElement('img');image.className='attachment-thumb';image.alt=alt;image.dataset.attachmentId=id;image.width=100;image.height=100;slot.append(image);
  image.loadPhoto=async()=>{try{const a=await this.get(id);if(epoch!==this.epoch||!image.isConnected)return;const url=URL.createObjectURL(a.blob);this.urls.add(url);image.src=url;image.dataset.previewUrl=url;}catch{if(epoch!==this.epoch||!image.isConnected)return;image.alt='Photo unavailable';const retry=document.createElement('button');retry.type='button';retry.className='ghost compact';retry.textContent='Retry photo';retry.onclick=()=>{retry.remove();image.loadPhoto()};slot.append(retry);}};
  this.observer.observe(image);
 }
}
