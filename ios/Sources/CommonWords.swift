// Generated from src/domain.js COMMON_ENGLISH_WORDS (same words, same order).
let commonEnglishWords: Set<String> = Set("""
a about above across after again against all am an and any are around as at be because been before
being below between both but by can could did do does doing down during each either else enough
even every few for from further had has have having he her here hers herself him himself his
honestly how i if in into is it its itself just like many may me might more most much must my
myself near neither no nor not now of off on once only onto or other our ours ourselves out over
own per please same she should since so some still such than that the their theirs them themselves
then there these they this those though through to together too under until up us very via was we
were what whatever when where whether which while who whom whose why will with within without would
yes you your yours yourself yourselves one two three four five six seven eight nine ten action
answer answers better brief bullet bullets change changes clear comment comments communication
current daily day days detail details document documents easier easy end example examples feedback
first general good group handoff handoffs help helpful idea ideas important issue issues large last
later little long low main meeting meetings member members memory message messages morning new next
note notes old open ordinary part parts people person plan plans point points problem problems
project projects question questions quick recent regular relevant reminder report reports request
requests response responses result results review reviews right routine rule rules schedule shared
short simple small status step steps suggestion suggestions support task tasks team teams thing
things time today tomorrow update updates usual week weekend weeks weekly work yesterday
challenging checklist checklists clarity communicate communicated communicating coordination
effective effectively flow improve improved improvement improvements information necessary obtain
obtained process processes standard standardized standards
""".split(whereSeparator: { $0 == " " || $0 == "\n" }).map(String.init))
