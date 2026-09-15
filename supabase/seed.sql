-- Seed data ported from rcl-pos.html's defaultMenuData(), EVENT_SPACES, and
-- sample MEMBERS/EMPLOYEES. Only for local dev — the admin "Manage menu"
-- screen is the real way to edit this once it exists.

-- ---------- rooms ----------
insert into rooms (key, name, capacity, is_screening_room, is_event_space, hourly_rate, cleaning_fee) values
  ('west_hall', 'West Hall (seating area only)', 30, false, true, 50, 30),
  ('indoor_cinema', 'Indoor Cinema (includes West Hall if needed)', 37, true, true, 75, 30),
  ('outdoor_cinema', 'Outdoor Cinema — patio, weather dependent', 120, false, true, 100, 30),
  ('entire_building', 'Entire building (patio, indoor & outdoor cinema, lounge, West Hall)', 200, false, true, 300, 50);

insert into room_addons (room_id, name, hourly_rate, sort_order)
  select id, 'Staff to sell drinks', 15, 0 from rooms where key = 'west_hall';
insert into room_addons (room_id, name, hourly_rate, sort_order)
  select id, 'Also use West Hall', 25, 0 from rooms where key = 'outdoor_cinema';

-- ---------- menu ----------
do $$
declare
  cat_grub uuid; cat_sweet uuid; cat_rad uuid; cat_caffe uuid; cat_spirits uuid; cat_tickets uuid;
  sub_beer uuid; sub_wine uuid; sub_cocktails uuid; sub_shots uuid;
  item uuid; grp uuid;
begin
  insert into menu_categories (key, label, sort_order) values ('grub', 'Food', 0) returning id into cat_grub;
  insert into menu_categories (key, label, sort_order) values ('sweet', 'Candy', 1) returning id into cat_sweet;
  insert into menu_categories (key, label, sort_order) values ('rad', 'Drinks', 2) returning id into cat_rad;
  insert into menu_categories (key, label, sort_order) values ('caffe', 'Coffee', 3) returning id into cat_caffe;
  insert into menu_categories (key, label, sort_order) values ('spirits', 'Alcohol', 4) returning id into cat_spirits;
  insert into menu_categories (key, label, sort_order) values ('tickets', 'Tickets and events', 5) returning id into cat_tickets;

  -- Food
  insert into menu_items (category_id, name, price, sort_order) values (cat_grub, 'Popcorn', 5, 0) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'size', 'Size', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Small', 0, 0), (grp, 'Medium', 1.5, 1), (grp, 'Large', 3, 2);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'addons', 'Add-ons', 'multi', 1) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Extra butter', 0, 0), (grp, 'Extra salt', 0, 1), (grp, 'Flavor packet', 0.75, 2);

  insert into menu_items (category_id, name, price, sort_order) values (cat_grub, 'Nachos', 7, 1) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'addons', 'Add-ons', 'multi', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Jalapeños', 0, 0), (grp, 'Extra cheese', 0.75, 1), (grp, 'Chili', 1.5, 2);

  insert into menu_items (category_id, name, price, sort_order) values (cat_grub, 'Hot dog', 6, 2) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'toppings', 'Toppings', 'multi', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Ketchup', 0, 0), (grp, 'Mustard', 0, 1), (grp, 'Relish', 0, 2),
    (grp, 'Onions', 0, 3), (grp, 'Chili', 1, 4), (grp, 'Extra cheese', 0.75, 5);

  insert into menu_items (category_id, name, price, sort_order) values (cat_grub, 'Pizza (large)', 15, 3) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'toppings', 'Toppings', 'multi', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Pepperoni', 1, 0), (grp, 'Sausage', 1, 1), (grp, 'Mushroom', 1, 2),
    (grp, 'Onion', 1, 3), (grp, 'Green pepper', 1, 4), (grp, 'Extra cheese', 1, 5);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'sauce', 'Sauce', 'single', 1) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Less sauce', 0, 0), (grp, 'Regular sauce', 0, 1), (grp, 'More sauce', 0, 2);

  -- Candy
  insert into menu_items (category_id, name, price, sort_order)
    select cat_sweet, name, 4, ord - 1
    from unnest(array['Milk duds','M&Ms','Nerds gummy clusters','Oreos','Peanut M&Ms','Reese''s','Skittles','Swedish fish'])
      with ordinality as t(name, ord);

  -- Drinks
  insert into menu_items (category_id, name, price, sort_order) values (cat_rad, 'Fountain drink', 3.5, 0) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'flavor', 'Flavor', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Coke', 0, 0), (grp, 'Diet Coke', 0, 1), (grp, 'Root beer', 0, 2), (grp, 'Sprite', 0, 3), (grp, 'Lemonade', 0, 4);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'size', 'Size', 'single', 1) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Small', 0, 0), (grp, 'Medium', 0.5, 1), (grp, 'Large', 1, 2);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'ice', 'Ice', 'single', 2) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Regular ice', 0, 0), (grp, 'Light ice', 0, 1), (grp, 'No ice', 0, 2);

  insert into menu_items (category_id, name, price, sort_order) values (cat_rad, 'Iced tea', 3.5, 1) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'sweet', 'Sweetness', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Sweet', 0, 0), (grp, 'Unsweet', 0, 1);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'size', 'Size', 'single', 1) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Small', 0, 0), (grp, 'Medium', 0.5, 1), (grp, 'Large', 1, 2);

  insert into menu_items (category_id, name, price, sort_order) values (cat_rad, 'Bottled water', 2, 2);

  -- Coffee
  insert into menu_items (category_id, name, price, sort_order) values (cat_caffe, 'Drip coffee', 3, 0) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'size', 'Size', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Small', 0, 0), (grp, 'Medium', 0.5, 1), (grp, 'Large', 1, 2);

  insert into menu_items (category_id, name, price, sort_order) values (cat_caffe, 'Latte', 4.5, 1) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'milk', 'Milk', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Whole', 0, 0), (grp, 'Oat', 0.75, 1), (grp, 'Almond', 0.75, 2), (grp, 'Nonfat', 0, 3);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'temp', 'Temperature', 'single', 1) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Hot', 0, 0), (grp, 'Iced', 0, 1);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'size', 'Size', 'single', 2) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Small', 0, 0), (grp, 'Medium', 0.5, 1), (grp, 'Large', 1, 2);
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'shots', 'Espresso', 'single', 3) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Single shot', 0, 0), (grp, 'Double shot', 1.25, 1);

  insert into menu_items (category_id, name, price, sort_order) values (cat_caffe, 'Espresso', 3, 2) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'shots', 'Shots', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Single', 0, 0), (grp, 'Double', 1.25, 1);

  -- Alcohol (with subcategories)
  insert into menu_categories (key, label, parent_id, sort_order) values ('beer', 'Beer', cat_spirits, 0) returning id into sub_beer;
  insert into menu_categories (key, label, parent_id, sort_order) values ('wine', 'Wine', cat_spirits, 1) returning id into sub_wine;
  insert into menu_categories (key, label, parent_id, sort_order) values ('cocktails', 'Cocktails', cat_spirits, 2) returning id into sub_cocktails;
  insert into menu_categories (key, label, parent_id, sort_order) values ('shots', 'Liquor shots', cat_spirits, 3) returning id into sub_shots;

  insert into menu_items (category_id, name, price, is_alcohol, sort_order) values
    (sub_beer, 'Draft lager', 6, true, 0),
    (sub_beer, 'IPA', 7, true, 1),
    (sub_beer, 'Stout', 7, true, 2),
    (sub_beer, 'Seasonal draft', 7, true, 3),
    (sub_wine, 'House red', 8, true, 0),
    (sub_wine, 'House white', 8, true, 1),
    (sub_wine, 'Sparkling', 9, true, 2),
    (sub_cocktails, 'Butter beer', 8, true, 0),
    (sub_cocktails, 'Long island iced tea', 10, true, 1),
    (sub_cocktails, 'Manhattan', 9, true, 2),
    (sub_cocktails, 'Margarita', 8, true, 3),
    (sub_cocktails, 'Moscow mule', 8, true, 4),
    (sub_cocktails, 'NY whiskey sour', 9, true, 5),
    (sub_cocktails, 'Old fashioned', 10, true, 6),
    (sub_cocktails, 'Paloma', 8, true, 7),
    (sub_cocktails, 'White russian', 8, true, 9);

  insert into menu_items (category_id, name, price, is_alcohol, sort_order) values
    (sub_cocktails, 'Rum or whiskey & coke', 8, true, 8) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'liquor', 'Liquor', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Rum', 0, 0), (grp, 'Whiskey', 0, 1);

  insert into menu_items (category_id, name, price, is_alcohol, sort_order) values (sub_shots, 'Well shot', 5, true, 0) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'liquor', 'Liquor', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Vodka', 0, 0), (grp, 'Rum', 0, 1), (grp, 'Whiskey', 0, 2), (grp, 'Tequila', 0, 3), (grp, 'Gin', 0, 4);

  insert into menu_items (category_id, name, price, is_alcohol, sort_order) values (sub_shots, 'Call shot', 7, true, 1) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'liquor', 'Liquor', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Vodka', 0, 0), (grp, 'Rum', 0, 1), (grp, 'Whiskey', 0, 2), (grp, 'Tequila', 0, 3), (grp, 'Gin', 0, 4);

  insert into menu_items (category_id, name, price, is_alcohol, sort_order) values (sub_shots, 'Premium shot', 9, true, 2) returning id into item;
  insert into menu_modifier_groups (item_id, key, label, type, sort_order) values (item, 'liquor', 'Liquor', 'single', 0) returning id into grp;
  insert into menu_modifier_options (group_id, name, price_delta, sort_order) values
    (grp, 'Vodka', 0, 0), (grp, 'Rum', 0, 1), (grp, 'Whiskey', 0, 2), (grp, 'Tequila', 0, 3), (grp, 'Gin', 0, 4);

  -- Tickets and events
  insert into menu_items (category_id, name, price, sort_order) values
    (cat_tickets, 'Day pass', 5, 0),
    (cat_tickets, 'Standard movie ticket', 8, 1),
    (cat_tickets, 'Classic release', 5, 2);
  insert into menu_items (category_id, name, price, is_event_item, event_price_mode, sort_order) values
    (cat_tickets, 'Make an event', 0, true, 'deposit', 3),
    (cat_tickets, 'Pay for an event', 0, true, 'full', 4);
end $$;

-- ---------- sample employees (PIN "9999" for all, bcrypt hash placeholder) ----------
-- Replace pin_hash values via the real employee-management screen once it
-- exists; these are for local dev only. Real hashing happens server-side.
insert into employees (name, pin_hash, role) values
  ('Jordan', '$dev$9999', 'cashier'),
  ('Casey', '$dev$9999', 'cashier'),
  ('Taylor', '$dev$9999', 'cashier'),
  ('Riley', '$dev$9999', 'manager');

-- ---------- sample members ----------
insert into members (name, tier, points) values
  ('Alex Rivera', 'Insiders+', 140),
  ('Jamie Chen', 'Insiders', 35),
  ('Morgan Blake', 'Insiders+', 210),
  ('Priya Nair', 'Insiders', 60),
  ('Sam Douglas', 'Insiders+', 95);
