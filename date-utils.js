function padCalendarPart(value){return String(value).padStart(2,'0')}
function localDateKey(date=new Date()){return `${date.getFullYear()}-${padCalendarPart(date.getMonth()+1)}-${padCalendarPart(date.getDate())}`}
function localMonthKey(date=new Date()){return localDateKey(date).slice(0,7)}
