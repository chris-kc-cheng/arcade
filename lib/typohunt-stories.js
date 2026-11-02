// Short stories for Typo Hunt levels 2 to 5. A passage is a run of consecutive sentences from ONE story, so it always reads as a
// single, sensible piece of writing. To keep any run coherent wherever it starts:
//  - every sentence introduces what it talks about (a name, "our class", "my brother", "the school bus") and never relies on an
//    earlier sentence: no bare he/she/they/it and no "the puppy" or "the neighbor" that only an earlier line has introduced;
//  - the sentences are in time order and stay in one tense, and no sentence contradicts another;
//  - `who` says which names may stand in for {n}: 'f' (she/her), 'm' (he/his), or 'x' (no protagonist name).
// Every sentence also holds several words the mistake rules can corrupt, so any run can be turned into a hunt.
const heroes = { f: ['Maya', 'Priya', 'Zoe', 'Noor'], m: ['Leo', 'Sam', 'Omar', 'Ben'], x: [] };

const stories = [
  { who: 'f', title: 'Library trip', lines: [
    'Last Saturday, {n} went to the library to find a book about rainforests.',
    'A librarian gave {n} an encyclopedia and a dictionary.',
    '{n} wrote some notes because she wanted to remember the interesting facts.',
    '{n} ate a sandwich at a quiet table near the window.',
    "{n}'s friends came to the library after lunch.",
    '{n} and her friends found information about three different animals together.',
    '{n} was happy with her knowledge, and she finished her work before dinner.'
  ] },
  { who: 'm', title: 'Soccer match', lines: [
    'Last Sunday, {n} played in a soccer game with his friends in the park.',
    'The weather was perfect, so the whole neighborhood came to watch the soccer game.',
    '{n} ran across the field and took a shot at the goal.',
    "The goalkeeper tried to catch the ball, but it flew over the goalkeeper's head.",
    "{n}'s team scored two goals and won the game.",
    'After the match, the players bought ice cream and drank cold water.',
    '{n} was tired but happy, and he slept well that night.'
  ] },
  { who: 'x', title: 'Morning routine', lines: [
    'Every morning, my family eats breakfast together.',
    'My father cooks eggs while my mother makes coffee.',
    'My little sister drinks milk and reads a comic book.',
    'I brush my teeth and wash my face before school.',
    "Our neighbors usually wait for the school bus at seven o'clock.",
    'My brother always forgets his lunch, so he has to go back home.',
    'We finally arrive at school at eight, and the day begins.'
  ] },
  { who: 'f', title: 'Birthday party', lines: [
    'Last Friday, {n} had a birthday party at her house.',
    "{n}'s friends brought gifts and balloons to her party.",
    "{n}'s father baked a chocolate cake with fresh strawberries.",
    'Everyone sang a song while {n} blew out the candles.',
    "{n}'s guests ate sandwiches, fruit, and a lot of cookies.",
    '{n} opened her presents and said thank you to everybody.',
    '{n} thought it was definitely the best birthday she could remember.'
  ] },
  { who: 'm', title: 'Camping trip', lines: [
    "Last summer, {n}'s family went camping near a beautiful lake.",
    '{n} and his father built a small tent near the water.',
    "In the evening, {n}'s family cooked sausages over a big fire.",
    '{n} saw a deer and two rabbits near the trees.',
    'The night was quiet, and the stars were very bright.',
    '{n} slept badly because the ground was hard and cold.',
    "On Sunday, {n}'s family packed their bags and drove home."
  ] },
  { who: 'x', title: 'Science fair', lines: [
    'Last month, our class entered the school science fair.',
    'We built a model volcano because we wanted to learn about chemistry.',
    'Our teacher gave us a big box of baking soda and vinegar.',
    'My partner and I mixed the baking soda and vinegar carefully.',
    'Our model volcano erupted, and everyone was surprised.',
    'Our project received an excellent score from the judges.',
    'We were proud because we worked together as a team.'
  ] },
  { who: 'f', title: 'Bakery visit', lines: [
    'On Saturday morning, {n} walked to the new bakery on Main Street.',
    'A baker showed {n} how to make fresh bread.',
    '{n} bought two loaves and a box of delicious cookies.',
    'The bakery on the corner smelled wonderful, and many people waited in line.',
    '{n} gave a loaf of fresh bread to her neighbor as a gift.',
    "{n}'s neighbor was surprised and invited {n} for tea.",
    '{n} and her neighbor talked about the weather and their favorite foods.'
  ] },
  { who: 'x', title: 'Rainy day at home', lines: [
    'Yesterday it rained all day, so we stayed inside.',
    'Yesterday afternoon, my brother and I played board games in the living room.',
    'My mother made hot chocolate and gave us warm cookies.',
    'We watched a funny movie and laughed a lot.',
    'My father read a long story to us before bedtime.',
    'Everyone was tired, so we went to bed early.',
    'Today the sun is shining, and the weather is warm again.'
  ] },
  { who: 'm', title: 'Piano lessons', lines: [
    'Every Tuesday, {n} goes to his piano lesson after school.',
    "{n}'s teacher is very patient and explains everything clearly.",
    '{n} plays one song every evening until it sounds perfect.',
    'Sometimes {n} makes mistakes, but he never gives up.',
    "{n}'s mother listens to the music from the kitchen.",
    'Next month, {n} will play at the school concert.',
    '{n} is nervous, but he definitely wants to do well.'
  ] },
  { who: 'f', title: 'New puppy', lines: [
    'Last weekend, {n} got a new puppy from the animal shelter.',
    "{n}'s new puppy was small and brown, and it had big ears.",
    '{n} named her new puppy Biscuit because it loved cookies.',
    "{n}'s puppy Biscuit ran around the garden and chased every butterfly.",
    '{n} taught her puppy to sit and to shake hands.',
    "{n}'s puppy slept on the sofa next to {n} that night.",
    '{n} was already in love with her new puppy.'
  ] },
  { who: 'x', title: 'Neighborhood garden', lines: [
    'Our neighborhood has a small garden behind the library.',
    'Every Saturday, the neighbors meet at the garden to plant vegetables.',
    'My grandmother knows a lot about flowers and herbs.',
    'The neighborhood children water the plants and pull the weeds.',
    'In summer, tomatoes grow quickly in the warm sun.',
    'We share fresh vegetables with everyone in the neighborhood.',
    'The garden is a wonderful place, and it brings people together.'
  ] },
  { who: 'f', title: 'Museum trip', lines: [
    "Last Wednesday, {n}'s class visited the city museum.",
    'The school bus arrived at nine because the traffic was light.',
    '{n} saw an enormous dinosaur skeleton in the main hall.',
    "A guide told {n}'s class interesting stories about ancient Egypt.",
    '{n} took many photographs and wrote a short report.',
    "At lunch, {n}'s class ate sandwiches in the park.",
    '{n} said that the museum was her favorite place in the city.'
  ] },
  { who: 'm', title: 'Exam week', lines: [
    '{n} has a big exam on Friday, so he studies every evening.',
    "{n}'s friend helps him with the difficult math problems.",
    '{n} and his friend do their homework together at the library.',
    'Sometimes {n} feels worried, but he takes a short walk.',
    "{n}'s teacher gives the class helpful advice about the exam.",
    '{n} always drinks some water and eats a healthy breakfast on exam day.',
    'After the exam, {n} feels relieved and he plans to celebrate.'
  ] },
  { who: 'f', title: 'Moving to a new town', lines: [
    "Last year, {n}'s family moved to a different town.",
    "{n}'s new house had a big yard and a lot of trees.",
    "At first, {n} felt lonely because she didn't know anyone.",
    'Then a friendly neighbor invited {n} to a barbecue.',
    '{n} met many interesting people at a neighborhood party.',
    'Soon {n} had three good friends and joined the school choir.',
    'Now {n} really loves her new neighborhood.'
  ] },
  { who: 'x', title: 'Weekend market', lines: [
    'Every Sunday, my parents take me to the farmers market.',
    'We buy fresh vegetables, bread, and sometimes cheese.',
    'The market vendors usually sell their products at low prices.',
    'My favorite stall sells delicious strawberries and chocolate.',
    'I always try a new fruit because I like different flavors.',
    'My mother talks to the farmers and asks many questions.',
    'We carry our heavy bags home and make lunch together.'
  ] },
  { who: 'm', title: 'Fishing trip', lines: [
    'Last July, {n} went fishing with his grandfather at a quiet lake.',
    '{n} and his grandfather woke up before sunrise and drove to the water.',
    "{n}'s grandfather showed {n} how to put a worm on the hook.",
    '{n} caught a small fish, but he threw it back into the water.',
    "{n}'s grandfather caught three big fish and was very proud.",
    'That evening, {n} and his grandfather ate fresh fish with potatoes and bread.',
    '{n} felt happy because he spent a wonderful day outside.'
  ] },
  { who: 'f', title: 'Art class', lines: [
    '{n} loves her art class because it is fun and creative.',
    'Mr. Brown teaches the class how to mix colors and draw faces.',
    'This week, {n} is painting a beautiful picture of the ocean.',
    '{n} uses blue, green, and a little yellow for the ocean waves.',
    "{n}'s classmates say that her painting looks really amazing.",
    'Mr. Brown hangs the best pictures in the hallway for everyone to see.',
    '{n} hopes that her picture will be there next week.'
  ] },
  { who: 'm', title: 'Bike repair', lines: [
    "Last Tuesday, {n}'s bike broke on the way to school.",
    '{n} ran to school instead and arrived ten minutes late.',
    'After class, {n} told his uncle about the problem.',
    "{n}'s uncle found a loose chain and fixed the broken bike quickly.",
    '{n} learned how to change a tire from his uncle.',
    'The next morning, {n} rode his bike to school again.',
    '{n} was proud because he had fixed part of the bike himself.'
  ] },
  { who: 'f', title: 'Animal shelter', lines: [
    'Every Saturday, {n} volunteers at the animal shelter.',
    '{n} feeds the cats and cleans their cages.',
    'The shelter manager says that {n} is a very responsible helper.',
    'Many people visit the shelter to adopt a pet.',
    '{n} gives visitors useful information about each animal.',
    'Last week, a family adopted two kittens because they wanted company.',
    '{n} was really happy, and she definitely wants to continue.'
  ] },
  { who: 'x', title: 'Winter morning', lines: [
    'It snowed last night, so the streets are white this morning.',
    'I put on my warm jacket, boots, and a thick scarf.',
    'My little brother wants to build a snowman in the yard.',
    'We roll three big snowballs and stack them carefully.',
    "My sister brings a carrot for a snowman's nose and two buttons for its eyes.",
    'Our neighbors watch from their window and wave at us.',
    'Then we drink hot chocolate, and our hands finally feel warm again.'
  ] },
  { who: 'm', title: 'First job', lines: [
    'Yesterday, {n} started his first job at a local restaurant.',
    'The restaurant manager welcomed {n} and showed him the kitchen.',
    '{n} learned the menu and wrote the specials on the board.',
    'A customer asked for a table near the window.',
    '{n} carried the plates carefully, but he dropped a glass.',
    'The restaurant manager smiled and said that everyone makes mistakes.',
    'At the end of the day, {n} was tired but really excited.'
  ] },
  { who: 'f', title: 'Swimming lessons', lines: [
    'Last summer, {n} took swimming lessons at the community pool.',
    'At first, the pool water felt cold, and {n} was afraid to put her face in it.',
    'The swimming coach told {n} to breathe slowly and relax.',
    '{n} practiced kicking her legs for twenty minutes.',
    'By the end of the week, {n} could float on her back.',
    '{n} swam across the pool while her coach clapped.',
    'Now {n} is getting ready for her first swimming race.'
  ] },
  { who: 'x', title: 'Dinner for grandmother', lines: [
    'Last Sunday, my sister and I cooked dinner for our grandmother.',
    'We bought tomatoes, onions, and fresh bread at the market.',
    'My sister chopped onions and tomatoes, and I made a big pot of soup.',
    "Our grandmother arrived at six o'clock and brought flowers.",
    'Our grandmother said that our soup smelled delicious.',
    'We ate together, talked for hours, and laughed a lot.',
    'Our family dinner was definitely one of the best evenings of the year.'
  ] },
  { who: 'm', title: 'Reading challenge', lines: [
    'The school library has a reading challenge this month.',
    '{n} wants to read twenty books before the end of February.',
    '{n} is reading an adventure book about pirates and treasure.',
    "{n}'s sister reads a different story every night.",
    'Our teacher gives a small prize to every student who finishes ten books.',
    '{n} writes a short review of each book in his notebook.',
    '{n} thinks that reading is the best way to learn new words.'
  ] },
  { who: 'f', title: 'Lost umbrella', lines: [
    'Last Monday, {n} accidentally left her umbrella on the train.',
    'At lunchtime, {n} went to the station office to ask about the umbrella.',
    'At the office, a clerk wrote down the details and said that someone might have found the umbrella.',
    'Two days later, {n} received a phone call from the lost property office.',
    'A kind passenger had handed the umbrella in, and it was waiting there.',
    '{n} picked the umbrella up on Wednesday and thanked the clerk.',
    'Now {n} always checks the seat before she leaves the train.'
  ] },
  { who: 'x', title: 'Neighborhood cleanup', lines: [
    'Last Saturday, our neighborhood organized a big cleanup day.',
    'Many people brought gloves, buckets, and garbage bags.',
    'My friends and I collected litter along the river.',
    'We found an old bicycle and a broken chair.',
    'The city sent a truck to take all the rubbish away.',
    'By noon, the riverbank was clean and beautiful again.',
    'Everyone was pleased, and we planned to do another cleanup next month.'
  ] },
  { who: 'm', title: 'Planning a picnic', lines: [
    '{n} wants to have a picnic on Sunday.',
    '{n} checks the weather forecast because he hates getting wet.',
    'The weather forecast says that tomorrow will be sunny and warm.',
    '{n} calls his cousins and invites them to the park.',
    "{n}'s cousins agree to bring something for lunch.",
    '{n} will make sandwiches, and his cousins will bring fruit.',
    'This Sunday is going to be a lovely day.'
  ] },
  { who: 'f', title: 'Learning to cook', lines: [
    '{n} is learning to cook dinner for her family.',
    "{n}'s mother shows her how to chop onions safely.",
    '{n} reads the recipe twice because she does not want to make a mistake.',
    'The kitchen smells wonderful when the tomato sauce begins to bubble.',
    '{n} tastes her sauce and adds a little salt.',
    "{n}'s family sits at the table and eats together.",
    "Everyone says that {n}'s dinner is excellent."
  ] },
  { who: 'x', title: 'Train journey', lines: [
    'Last winter, I took a train to visit my cousins.',
    'The train journey was long, but the scenery was really beautiful.',
    'I sat by the window and watched the snow fall.',
    'A friendly woman gave me an apple and a sandwich.',
    'We talked about our families and our favorite books.',
    'Our train finally arrived at the station on Thursday morning.',
    'My cousins were waiting for me with a big sign.'
  ] },
  { who: 'f', title: 'School recycling', lines: [
    "{n}'s school has a new recycling program.",
    'Students separate paper, plastic, and glass into different bins.',
    '{n} checks the school bins every Friday and reminds her classmates.',
    'Some people forget which bin to use, so {n} makes colorful signs.',
    'Colorful signs help everyone understand the recycling rules.',
    'Because of the recycling program, the school wastes much less paper.',
    '{n} is proud that her school is helping the environment.'
  ] }
];

module.exports = { heroes, stories };
